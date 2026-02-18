import { type CardDetail } from '../card-information/card-calculator'
import { DeckCalculator } from '../deck-information/deck-calculator'
import { type RecommendDeck, type ScoreFunction } from './base-deck-recommend'
import { type EventConfig } from '../event-point/event-service'
import { type MusicMeta } from '../common/music-meta'
import { swap } from '../util/collection-util'

// ======================== 配置 ========================

export interface GAConfig {
  /** 随机数种子，-1 使用当前时间 */
  seed?: number
  /** 最大迭代次数 */
  maxIter?: number
  /** 最大无改进迭代次数 */
  maxIterNoImprove?: number
  /** 种群大小 */
  popSize?: number
  /** 父代数量 */
  parentSize?: number
  /** 精英数量 */
  eliteSize?: number
  /** 交叉率 */
  crossoverRate?: number
  /** 基础变异率 */
  baseMutationRate?: number
  /** 无改进迭代次数转换为变异率的比例 */
  noImproveIterToMutationRate?: number
  /** 超时时间（毫秒） */
  timeoutMs?: number
}

const DEFAULT_GA_CONFIG: Required<GAConfig> = {
  seed: -1,
  maxIter: 500,
  maxIterNoImprove: 5,
  popSize: 2000,
  parentSize: 200,
  eliteSize: 0,
  crossoverRate: 1.0,
  baseMutationRate: 0.1,
  noImproveIterToMutationRate: 0.02,
  timeoutMs: 15000
}

// ======================== 简易伪随机数生成器 ========================

class SimpleRng {
  private state: number

  constructor (seed: number) {
    this.state = seed & 0x7fffffff
    if (this.state === 0) this.state = 1
  }

  /** 返回 [0, 1) 的浮点数 */
  next (): number {
    // xorshift32
    this.state ^= this.state << 13
    this.state ^= this.state >>> 17
    this.state ^= this.state << 5
    return (this.state >>> 0) / 4294967296
  }

  /** 返回 [0, max) 的整数 */
  nextInt (max: number): number {
    return Math.floor(this.next() * max)
  }
}

// ======================== 个体 ========================

interface Individual {
  deck: CardDetail[]
  deckHash: number
  fitness: number
}

// ======================== 工具函数 ========================

/** 计算卡组哈希（第一位 + 后几位排序后） */
function calcDeckHash (deck: CardDetail[]): number {
  if (deck.length === 0) return 0
  const ids = deck.map(c => c.cardId)
  // 后面的排序
  const sorted = ids.slice(1).sort((a, b) => a - b)
  const BASE = 10007
  let hash = ids[0]
  for (const id of sorted) {
    hash = ((hash * BASE) + id) | 0
  }
  return hash >>> 0
}


// ======================== GA 主函数 ========================

/**
 * 使用遗传算法寻找最佳卡组
 * @param cardDetails 参与计算的卡牌
 * @param allCards 全部卡牌（用于支援卡组计算）
 * @param scoreFunc 分数计算函数
 * @param musicMeta 歌曲信息
 * @param limit 需要推荐的卡组数量
 * @param isChallengeLive 是否挑战Live
 * @param member 人数限制
 * @param honorBonus 称号加成
 * @param eventConfig 活动配置
 * @param gaConfig GA配置
 */
export function findBestCardsGA (
  cardDetails: CardDetail[],
  allCards: CardDetail[],
  scoreFunc: ScoreFunction,
  musicMeta: MusicMeta,
  limit: number = 1,
  isChallengeLive: boolean = false,
  member: number = 5,
  honorBonus: number = 0,
  eventConfig: EventConfig = {},
  gaConfig: GAConfig = {}
): RecommendDeck[] {
  const cfg = { ...DEFAULT_GA_CONFIG, ...gaConfig }

  if (isChallengeLive) {
    member = Math.min(member, cardDetails.length)
  }

  if (cardDetails.length < member) {
    return []
  }

  const seed = cfg.seed === -1 ? Date.now() : cfg.seed
  const rng = new SimpleRng(seed)
  const startTime = Date.now()

  const isTimeout = (): boolean => Date.now() - startTime > cfg.timeoutMs

  // 按角色分组
  const MAX_CID = 27
  const charaCards: CardDetail[][] = Array.from({ length: MAX_CID }, () => [])
  for (const card of cardDetails) {
    charaCards[card.characterId].push(card)
  }

  // deck hash 缓存
  const deckScoreCache = new Map<number, number>()

  // 结果管理
  let bestDecks: RecommendDeck[] = []

  const updateResult = (deck: RecommendDeck): void => {
    // 检查是否已存在相同卡组
    const exists = bestDecks.some(d =>
      d.cards[0].cardId === deck.cards[0].cardId &&
      d.score === deck.score &&
      d.power.total === deck.power.total
    )
    if (exists) return

    bestDecks.push(deck)
    bestDecks.sort((a, b) => b.score - a.score)
    if (bestDecks.length > limit) {
      bestDecks = bestDecks.slice(0, limit)
    }
  }

  // 评估个体
  const evaluateIndividual = (individual: Individual): void => {
    const hash = calcDeckHash(individual.deck)
    individual.deckHash = hash

    if (deckScoreCache.has(hash)) {
      individual.fitness = deckScoreCache.get(hash)!
      return
    }

    // 找最佳C位（技能最高的放C位）
    let bestSkillIdx = 0
    for (let i = 1; i < individual.deck.length; i++) {
      if (individual.deck[bestSkillIdx].skill.isCertainlyLessThen(individual.deck[i].skill)) {
        bestSkillIdx = i
      }
    }
    if (bestSkillIdx !== 0) {
      swap(individual.deck, 0, bestSkillIdx)
    }

    const deckDetail = DeckCalculator.getDeckDetailByCards(
      individual.deck, allCards, honorBonus,
      eventConfig.cardBonusCountLimit,
      eventConfig.worldBloomDifferentAttributeBonuses
    )
    const score = scoreFunc(musicMeta, deckDetail)
    individual.fitness = score

    deckScoreCache.set(hash, score)

    // 更新全局最优
    const recDeck = deckDetail as RecommendDeck
    recDeck.score = score
    updateResult(recDeck)
  }

  // 生成随机个体
  const generateRandomIndividual = (): Individual | null => {
    const deck: CardDetail[] = []
    const usedCharas = new Set<number>()
    const usedCardIds = new Set<number>()

    if (!isChallengeLive) {
      // 随机选择 member 个不同角色
      const validCharas: number[] = []
      for (let i = 0; i < MAX_CID; i++) {
        if (charaCards[i].length > 0) validCharas.push(i)
      }
      if (validCharas.length < member) return null

      // 随机打乱并取前 member 个
      for (let i = validCharas.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1)
        const tmp = validCharas[i]
        validCharas[i] = validCharas[j]
        validCharas[j] = tmp
      }
      const selectedCharas = validCharas.slice(0, member)

      for (const chara of selectedCharas) {
        const cards = charaCards[chara]
        const idx = rng.nextInt(cards.length)
        deck.push(cards[idx])
      }
    } else {
      // 挑战Live：随机选 member 张不重复的卡
      const indices: number[] = []
      let attempts = 0
      while (indices.length < member && attempts < 100) {
        const idx = rng.nextInt(cardDetails.length)
        if (!usedCardIds.has(cardDetails[idx].cardId)) {
          usedCardIds.add(cardDetails[idx].cardId)
          indices.push(idx)
        }
        attempts++
      }
      if (indices.length < member) return null
      for (const idx of indices) {
        deck.push(cardDetails[idx])
      }
    }

    return { deck, deckHash: 0, fitness: 0 }
  }

  // 交叉
  const crossover = (a: Individual, b: Individual): Individual | null => {
    if (rng.next() > cfg.crossoverRate) {
      return a.fitness >= b.fitness ? { ...a, deck: [...a.deck] } : { ...b, deck: [...b.deck] }
    }

    const deck: CardDetail[] = []
    const usedCharas = new Set<number>()
    const usedCardIds = new Set<number>()

    // 从 a 中随机保留一些位置
    const keepFromA: number[] = []
    for (let i = 0; i < a.deck.length; i++) {
      if (rng.next() > 0.5) {
        keepFromA.push(i)
      }
    }

    // 添加 a 中保留的卡
    for (const idx of keepFromA) {
      const card = a.deck[idx]
      deck.push(card)
      usedCharas.add(card.characterId)
      usedCardIds.add(card.cardId)
    }

    // 从 b 中补充不冲突的卡
    const bCandidates: number[] = []
    for (let i = 0; i < b.deck.length; i++) {
      const card = b.deck[i]
      if (usedCardIds.has(card.cardId)) continue
      if (!isChallengeLive && usedCharas.has(card.characterId)) continue
      bCandidates.push(i)
    }

    // 随机打乱 b 候选
    for (let i = bCandidates.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1)
      const tmp = bCandidates[i]
      bCandidates[i] = bCandidates[j]
      bCandidates[j] = tmp
    }

    const needed = member - deck.length
    for (let i = 0; i < Math.min(needed, bCandidates.length); i++) {
      const card = b.deck[bCandidates[i]]
      deck.push(card)
      usedCharas.add(card.characterId)
      usedCardIds.add(card.cardId)
    }

    if (deck.length < member) return null

    return { deck, deckHash: 0, fitness: 0 }
  }

  // 变异
  const mutate = (individual: Individual, mutationRate: number): void => {
    for (let pos = 0; pos < individual.deck.length; pos++) {
      if (rng.next() > mutationRate) continue

      // 尝试替换
      for (let attempt = 0; attempt < 10; attempt++) {
        let newCard: CardDetail
        if (!isChallengeLive) {
          // 从同角色或随机角色中选
          if (rng.next() < 0.5) {
            // 同角色不同卡
            const chara = individual.deck[pos].characterId
            const cards = charaCards[chara]
            if (cards.length <= 1) continue
            newCard = cards[rng.nextInt(cards.length)]
          } else {
            // 随机角色
            newCard = cardDetails[rng.nextInt(cardDetails.length)]
          }
        } else {
          newCard = cardDetails[rng.nextInt(cardDetails.length)]
        }

        // 检查冲突
        let ok = true
        for (let i = 0; i < individual.deck.length; i++) {
          if (i === pos) continue
          if (individual.deck[i].cardId === newCard.cardId) { ok = false; break }
          if (!isChallengeLive && individual.deck[i].characterId === newCard.characterId) { ok = false; break }
        }
        if (ok) {
          individual.deck[pos] = newCard
          break
        }
      }
    }
  }

  // ======================== 主循环 ========================

  // 生成初始种群
  let population: Individual[] = []
  for (let i = 0; i < cfg.popSize; i++) {
    if (isTimeout()) break
    const ind = generateRandomIndividual()
    if (ind === null) continue
    evaluateIndividual(ind)
    population.push(ind)
  }

  if (population.length === 0) {
    return bestDecks
  }

  let curMaxFitness = 0
  let lastMaxFitness = 0
  let noImproveIter = 0

  // 迭代进化
  for (let iter = 0; iter < cfg.maxIter; iter++) {
    if (isTimeout()) break

    // 排序
    population.sort((a, b) => b.fitness - a.fitness)
    lastMaxFitness = curMaxFitness
    const curMutationRate = cfg.baseMutationRate + cfg.noImproveIterToMutationRate * noImproveIter

    const newPopulation: Individual[] = []

    // 保留精英
    const eliteSize = Math.min(cfg.eliteSize, population.length)
    for (let i = 0; i < eliteSize; i++) {
      newPopulation.push(population[i])
    }

    // 繁殖
    const parentSize = Math.min(cfg.parentSize, population.length)
    while (newPopulation.length < cfg.popSize) {
      if (isTimeout()) break

      const idx1 = rng.nextInt(parentSize)
      const idx2 = rng.nextInt(parentSize)
      const child = crossover(population[idx1], population[idx2])
      if (child === null) continue

      mutate(child, curMutationRate)
      evaluateIndividual(child)
      newPopulation.push(child)
      curMaxFitness = Math.max(curMaxFitness, child.fitness)
    }

    // 去重
    const seen = new Set<number>()
    population = []
    for (const ind of newPopulation) {
      if (!seen.has(ind.deckHash)) {
        population.push(ind)
        seen.add(ind.deckHash)
      }
    }

    // 检查收敛
    if (curMaxFitness <= lastMaxFitness) {
      noImproveIter++
      if (noImproveIter > cfg.maxIterNoImprove) break
    } else {
      noImproveIter = 0
    }
  }

  return bestDecks
}
