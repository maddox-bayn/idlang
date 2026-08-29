FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum
COPY backend/go.* ./

# Download dependencies
RUN go mod download

# Copy backend source
COPY backend/ ./

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o idlang-backend .

# Production stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates

# Copy binary
COPY --from=builder /app/idlang-backend .

EXPOSE 8080

CMD ["./idlang-backend"]
