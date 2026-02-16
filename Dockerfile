# Build Stage for Frontend
FROM node:20-alpine AS builder-web
RUN npm install -g npm@10.8.2
WORKDIR /app
COPY refer/re_sekai-calculator/ refer/re_sekai-calculator/
COPY web/ web/
WORKDIR /app/web
# Set API URL empty to allow relative fetching
ENV NEXT_PUBLIC_API_URL=
RUN npm ci
RUN npm run build

# Build Stage for Backend
FROM golang:1.23-alpine AS builder-go
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY main.go .
RUN go build -o server main.go

# Runtime Stage
FROM alpine:latest
WORKDIR /app

# Copy Backend
COPY --from=builder-go /app/server ./server

# Copy Frontend Static Export
COPY --from=builder-web /app/web/out ./dist

# Copy Master Data
COPY data/ ./data/

# Install certs for external API calls from backend
RUN apk add --no-cache ca-certificates

# Go server runs on 8080
EXPOSE 8080

CMD ["./server"]
