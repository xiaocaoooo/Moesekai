import { type DataProvider } from '../data-provider/data-provider'
import { CardCalculator, type CardConfig, type CardDetail } from '../card-information/card-calculator'
import {
  DeckCalculator,
  type DeckDetail
} from '../deck-information/deck-calculator'
import { LiveType } from '../live-score/live-calculator'
import { type UserCard } from '../user-data/user-card'
import { type MusicMeta } from '../common/music-meta'
import { containsAny, swap } from '../util/collection-util'
import { filterCardPriority } from '../card-priority/card-priority-filter'
import { isDeckAttrLessThan3, toRecommendDeck, updateDeck } from './deck-result-update'
import { AreaItemService } from '../area-item-information/area-item-service'
import { type EventConfig, EventType } from '../event-point/event-service'
import { findBestCardsGA, type GAConfig } from './find-best-cards-ga'

/** 推荐算法类型 */
export enum RecommendAlgorithm {
  /** 深度优先搜索（精确但慢） */
  DFS = 'dfs',
  /** 遗传算法（快速近似） */
  GA = 'ga'
}

export class BaseDeckRecommend {
  private readonly cardCalculator: CardCalculator
  private readonly deckCalculator: DeckCalculator
  private readonly areaItemService: AreaItemService

  public constructor (private readonly dataProvider: DataProvider) {
    this.cardCalculator = new CardCalculator(dataProvider)
    this.deckCalculator = new DeckCalculator(dataProvider)
    this.areaItemService = new AreaItemService(dataProvider)
  }

  /**
   * 使用递归寻找最佳卡组（DFS）
   * 栈深度不超过member+1层
   * 复杂度O(n^member)，带大量剪枝和超时控制
   */
  private static findBestCardsDFS (
    cardDetails: CardDetail[], allCards: CardDetail[], scoreFunc: (deckDetail: DeckDetail) => number, limit: number = 1,
    isChallengeLive: boolean = false, member: number = 5, leaderCharacter: number = 0, honorBonus: number = 0,
    eventConfig: EventConfig = {},
    deckCards: CardDetail[] = [],
    dfsState?: DFSState
  ): RecommendDeck[] {
    // 超时检查
    if (dfsState !== undefined && dfsState.isTimeout()) {
      return dfsState.bestDecks
    }

    // 防止挑战Live卡的数量小于允许上场的数量导致无法组队
    if (isChallengeLive) {
      member = Math.min(member, cardDetails.length)
    }
    // 已经是完整卡组，计算当前卡组的值
    if (deckCards.length === member) {
      const deckDetail = DeckCalculator.getDeckDetailByCards(
        deckCards, allCards, honorBonus, eventConfig.cardBonusCountLimit,
        eventConfig.worldBloomDifferentAttributeBonuses
      )
      const score = scoreFunc(deckDetail)

      // 检查 hash 缓存
      if (dfsState !== undefined) {
        const hash = BaseDeckRecommend.calcDeckHash(deckCards)
        if (dfsState.deckHashCache.has(hash)) {
          return dfsState.bestDecks
        }
        dfsState.deckHashCache.add(hash)
      }

      // 如果固定leader，不检查技能效果直接返回
      if (leaderCharacter > 0) {
        return toRecommendDeck(deckDetail, score)
      }
      // 寻找加分效果最高的卡牌
      const cards = deckDetail.cards
      let bestScoreUp = cards[0].skill.scoreUp
      let bestScoreIndex = 0
      cards.forEach((it, i) => {
        if (it.skill.scoreUp > bestScoreUp) {
          bestScoreUp = it.skill.scoreUp
          bestScoreIndex = i
        }
      })
      // 如果现在C位已经对了
      if (bestScoreIndex === 0) {
        return toRecommendDeck(deckDetail, score)
      }
      // 不然就重新算调整过C位后的分数
      swap(deckCards, 0, bestScoreIndex)
      return BaseDeckRecommend.findBestCardsDFS(
        cardDetails, allCards, scoreFunc, limit, isChallengeLive, member, leaderCharacter, honorBonus,
        eventConfig, deckCards, dfsState)
    }
    // 非完整卡组，继续遍历所有情况
    let ans: RecommendDeck[] = []
    let preCard: CardDetail | null = null
    for (const card of cardDetails) {
      // 超时检查
      if (dfsState !== undefined && dfsState.isTimeout()) {
        return ans.length > 0 ? ans : dfsState.bestDecks
      }

      // 跳过已经重复出现过的卡牌
      if (deckCards.some(it => it.cardId === card.cardId)) {
        continue
      }
      // 跳过重复角色
      if (!isChallengeLive && deckCards.some(it => it.characterId === card.characterId)) {
        continue
      }
      // 如果固定leader，要判断第一张卡是不是指定角色
      if (leaderCharacter > 0 && deckCards.length === 0 && card.characterId !== leaderCharacter) {
        continue
      }
      // C位一定是技能最好的卡牌，跳过技能比C位还好的
      if (leaderCharacter <= 0 && deckCards.length >= 1 && deckCards[0].skill.isCertainlyLessThen(card.skill)) {
        continue
      }
      // 为了优化性能，必须和C位同色或同组
      if (deckCards.length >= 1 && card.attr !== deckCards[0].attr && !containsAny(deckCards[0].units, card.units)) {
        continue
      }
      // 为了优化性能，如果是World Link活动，强制3色及以上
      if (eventConfig.worldBloomDifferentAttributeBonuses !== undefined && isDeckAttrLessThan3(deckCards, card)) {
        continue
      }
      // 要求生成的卡组后面4个位置按强弱排序、同强度按卡牌ID排序
      if (deckCards.length >= 2 && CardCalculator.isCertainlyLessThan(deckCards[deckCards.length - 1], card)) {
        continue
      }
      if (deckCards.length >= 2 && !CardCalculator.isCertainlyLessThan(card, deckCards[deckCards.length - 1]) &&
        card.cardId < deckCards[deckCards.length - 1].cardId) {
        continue
      }
      // 如果肯定比上一次选定的卡牌要弱，那么舍去
      if (preCard !== null && CardCalculator.isCertainlyLessThan(card, preCard)) {
        continue
      }
      preCard = card
      // 递归
      const result = BaseDeckRecommend.findBestCardsDFS(
        cardDetails, allCards, scoreFunc, limit, isChallengeLive, member, leaderCharacter, honorBonus,
        eventConfig, [...deckCards, card], dfsState)
      ans = updateDeck(ans, result, limit)
    }
    // 在最外层检查一下是否成功组队
    if (deckCards.length === 0 && ans.length === 0) {
      console.warn(`Cannot find deck in ${cardDetails.length} cards(${cardDetails.map(it => it.cardId).toString()})`)
      return []
    }
    return ans
  }

  /** 计算卡组哈希（用于去重缓存） */
  private static calcDeckHash (deckCards: CardDetail[]): number {
    if (deckCards.length === 0) return 0
    const ids = deckCards.map(c => c.cardId)
    const sorted = ids.slice(1).sort((a, b) => a - b)
    const BASE = 10007
    let hash = ids[0]
    for (const id of sorted) {
      hash = ((hash * BASE) + id) | 0
    }
    return hash >>> 0
  }

  /**
   * 推荐高分卡组
   */
  public async recommendHighScoreDeck (
    userCards: UserCard[], scoreFunc: ScoreFunction,
    {
      musicMeta,
      limit = 1,
      member = 5,
      leaderCharacter = undefined,
      cardConfig = {},
      debugLog = (_: string) => {
      },
      algorithm = RecommendAlgorithm.GA,
      gaConfig = {},
      timeoutMs = 30000
    }: DeckRecommendConfig,
    liveType: LiveType,
    eventConfig: EventConfig = {}
  ): Promise<RecommendDeck[]> {
    const { eventType = EventType.NONE, eventUnit, specialCharacterId, worldBloomType, worldBloomSupportUnit } = eventConfig
    const honorBonus = await this.deckCalculator.getHonorBonusPower()
    const areaItemLevels = await this.areaItemService.getAreaItemLevels()
    let cards =
        await this.cardCalculator.batchGetCardDetail(userCards, cardConfig, eventConfig, areaItemLevels)

    // 过滤箱活的卡
    let filterUnit = eventUnit
    if (worldBloomSupportUnit !== undefined) {
      filterUnit = worldBloomSupportUnit
    }
    if (filterUnit !== undefined) {
      const originCardsLength = cards.length
      cards = cards.filter(it =>
        (it.units.length === 1 && it.units[0] === 'piapro') ||
          filterUnit === undefined || it.units.includes(filterUnit))
      debugLog(`Cards filtered with unit ${filterUnit}: ${cards.length}/${originCardsLength}`)
      debugLog(cards.map(it => it.cardId).toString())
    }
    // World Link Finale，需要强制指定Leader
    if (worldBloomType === 'finale') {
      leaderCharacter = specialCharacterId
    }

    const startTime = Date.now()
    const isTimeout = (): boolean => Date.now() - startTime > timeoutMs

    // 如果使用 GA 算法
    if (algorithm === RecommendAlgorithm.GA) {
      debugLog(`Using GA algorithm with ${cards.length} cards`)

      // GA 不需要 filterCardPriority，直接用全部卡牌
      const gaResult = findBestCardsGA(
        cards, cards, scoreFunc, musicMeta, limit,
        liveType === LiveType.CHALLENGE, member, honorBonus, eventConfig,
        { ...gaConfig, timeoutMs: Math.max(1000, timeoutMs - (Date.now() - startTime)) }
      )

      if (gaResult.length >= limit) {
        debugLog(`GA found ${gaResult.length} deck(s)`)
        return gaResult
      }

      // GA 结果不足，fallback 到 DFS
      debugLog(`GA found ${gaResult.length} deck(s), falling back to DFS`)
      if (isTimeout()) return gaResult

      // 用 DFS 补充
      let preCardDetails = [] as CardDetail[]
      while (!isTimeout()) {
        const cardDetails =
            filterCardPriority(liveType, eventType, cards, preCardDetails, member, leaderCharacter)
        if (cardDetails.length === preCardDetails.length) {
          return gaResult.length > 0 ? gaResult : []
        }
        preCardDetails = cardDetails
        const cards0 = cardDetails.sort((a, b) => a.cardId - b.cardId)
        debugLog(`DFS fallback with ${cards0.length}/${cards.length} cards`)

        const dfsState = new DFSState(Math.max(1000, timeoutMs - (Date.now() - startTime)))
        const recommend = BaseDeckRecommend.findBestCardsDFS(cards0, cards,
          deckDetail => scoreFunc(musicMeta, deckDetail), limit, liveType === LiveType.CHALLENGE, member,
          leaderCharacter, honorBonus, eventConfig, [], dfsState)

        // 合并 GA 和 DFS 结果
        const merged = updateDeck(gaResult, recommend, limit)
        if (merged.length >= limit) return merged
      }
      return gaResult
    }

    // DFS 算法（原始逻辑 + 超时控制）
    let preCardDetails = [] as CardDetail[]
    while (!isTimeout()) {
      const cardDetails =
          filterCardPriority(liveType, eventType, cards, preCardDetails, member, leaderCharacter)
      if (cardDetails.length === preCardDetails.length) {
        throw new Error(`Cannot recommend any deck in ${cards.length} cards`)
      }
      preCardDetails = cardDetails
      const cards0 = cardDetails.sort((a, b) => a.cardId - b.cardId)
      debugLog(`Recommend deck with ${cards0.length}/${cards.length} cards`)
      debugLog(cards0.map(it => it.cardId).toString())

      const dfsState = new DFSState(Math.max(1000, timeoutMs - (Date.now() - startTime)))
      const recommend = BaseDeckRecommend.findBestCardsDFS(cards0, cards,
        deckDetail => scoreFunc(musicMeta, deckDetail), limit, liveType === LiveType.CHALLENGE, member,
        leaderCharacter, honorBonus, eventConfig, [], dfsState)
      if (recommend.length >= limit) return recommend
    }
    throw new Error(`Timeout: Cannot recommend deck in ${timeoutMs}ms`)
  }
}

/** DFS 状态管理（超时 + hash 缓存） */
class DFSState {
  public readonly deckHashCache = new Set<number>()
  public bestDecks: RecommendDeck[] = []
  private readonly startTime: number
  private readonly timeoutMs: number

  constructor (timeoutMs: number = 30000) {
    this.startTime = Date.now()
    this.timeoutMs = timeoutMs
  }

  public isTimeout (): boolean {
    return Date.now() - this.startTime > this.timeoutMs
  }
}

export type ScoreFunction = (musicMeta: MusicMeta, deckDetail: DeckDetail) => number

export interface RecommendDeck extends DeckDetail {
  score: number
}

export interface DeckRecommendConfig {
  musicMeta: MusicMeta
  limit?: number
  member?: number
  leaderCharacter?: number
  cardConfig?: Record<string, CardConfig>
  debugLog?: (str: string) => void
  /** 推荐算法，默认 GA */
  algorithm?: RecommendAlgorithm
  /** GA 算法配置 */
  gaConfig?: GAConfig
  /** 超时时间（毫秒），默认 30 秒 */
  timeoutMs?: number
}
