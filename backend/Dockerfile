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

# The dictionary is read from the working directory at runtime, so it has to be in
# the final image too -- copying only the binary left the backend logging all three
# "could not load dictionary" warnings and serving an empty dictionary.
#
# The glob always matches the committed v1/v2 files. It also picks up the generated
# idoma_dictionary_v3.json when it is present in the build context, which is what
# makes dictionary-first routing actually work. v3 is not committed (scraped
# idomaland.org content, public repo), so a git-based build gets v2 unless you
# regenerate it first:
#
#     python data_pipeline/build_dictionary.py
COPY --from=builder /app/idoma_dictionary*.json ./

EXPOSE 8080

CMD ["./idlang-backend"]
