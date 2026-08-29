# Deployment Guide for Idlang

This guide covers deploying Idlang to various cloud platforms.

## Prerequisites

- Docker and Docker Compose installed
- GitHub account
- Cloud provider account (AWS, GCP, or Azure)

## Quick Start with Docker

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Deploy to GitHub Pages (Frontend Only)

GitHub Pages is ideal for hosting the static React frontend:

```bash
# Install gh-pages
npm install gh-pages --save-dev

# Update package.json
{
  "homepage": "https://<username>.github.io/idlang",
  "scripts": {
    "predeploy": "npm run build",
    "deploy": "gh-pages -d build"
  }
}

# Deploy
npm run deploy
```

## Deploy to Vercel

1. Push code to GitHub repository
2. Import project to [Vercel Dashboard](https://vercel.com/new)
3. Configure environment variables:
   - `VITE_API_URL` = Your backend URL
4. Click Deploy

## Deploy to Netlify

1. Connect GitHub repository to Netlify
2. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Environment variables:
   - `VITE_API_URL` = Your backend URL
4. Deploy site

## Deploy to AWS

### Option 1: ECS with Fargate

1. Push Docker images to Amazon ECR
2. Create ECS cluster
3. Create task definition with:
   - Frontend container (nginx)
   - Backend container (Go)
   - Translator container (Python)
4. Create service with load balancer

### Option 2: EC2

```bash
# On EC2 instance
sudo apt update
sudo apt install docker.io docker-compose

# Clone repo
git clone https://github.com/<username>/idlang.git
cd idlang

# Start services
docker-compose up -d
```

## Deploy to Google Cloud Platform

### Cloud Run (Container-based)

```bash
# Build and push image
gcloud builds submit --tag gcr.io/<project>/idlang-translator

# Deploy service
gcloud run deploy idlang-translator \
  --image gcr.io/<project>/idlang-translator \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### GKE (Kubernetes)

```bash
# Create cluster
gcloud container clusters create idlang-cluster --num-nodes=3

# Deploy
kubectl apply -f kubernetes/
```

## Deploy to Azure

### Azure Container Instances

```bash
# Build image
az acr build --registry <registry> --image idlang-translator .

# Deploy to ACI
az container create \
  --resource-group idlang-rg \
  --name idlang-translator \
  --image <registry>.azurecr.io/idlang-translator:latest \
  --cpu 4 \
  --memory 8 \
  --ports 5005 \
  --environment-variables DEVICE=cuda
```

## Environment Variables Reference

### Frontend (.env.production)
```bash
VITE_API_URL=https://api.idlang.com
```

### Backend (.env)
```bash
TRANSLATOR_URL=http://translator:5005
PORT=8080
```

### Translator Service (.env)
```bash
DEVICE=cuda
CACHE_DIR=/app/model_cache
PORT=5005
```

## Monitoring and Logging

### View container logs
```bash
docker-compose logs -f translator
```

### Health check endpoint
```bash
curl http://localhost:5005/health
```

## Scaling

### Horizontal scaling
```bash
docker-compose up -d --scale translator=3
```

### Resource limits (docker-compose.yml)
```yaml
services:
  translator:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 8G
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs <service-name>

# Restart service
docker-compose restart <service-name>
```

### Model download issues
```bash
# Pull models first
docker-compose run translator python -c "from services.model_loader import ModelManager; ModelManager.load_nmt_models()"
```

### Port conflicts
Update port mappings in `docker-compose.yml`:
```yaml
ports:
  - "8081:8080"  # Backend on port 8081
  - "5006:5005"  # Translator on port 5006
```
