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
# The glob matches both committed dictionaries: idoma_dictionary_v3.json (226 curated
# entries, the one DICTIONARY_PATH points at) and the small idoma_dictionary.json
# fallback. v3 is committed now, so a plain git-based build gets a working
# dictionary-first deploy with no regeneration step.
#
# It also still picks up a locally regenerated 1,117-entry v3 from
# data_pipeline/build_dictionary.py if you build from a working tree that has one.
COPY --from=builder /app/idoma_dictionary*.json ./

EXPOSE 8080

CMD ["./idlang-backend"]
