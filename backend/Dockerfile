FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o webhook-server ./cmd/server

FROM alpine:3.23

RUN apk --no-cache add ca-certificates wget
WORKDIR /app
COPY --from=builder /app/webhook-server .

EXPOSE 8080
CMD ["./webhook-server"]
