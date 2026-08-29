# Pushing to GitHub - Authentication Guide

The code is ready to push but requires GitHub authentication. Here are your options:

## Option 1: Push via GitHub CLI (Recommended)

If you have `gh` installed:

```bash
# Authenticate with GitHub
gh auth login

# Push the changes
git push origin main
```

## Option 2: Push via Personal Access Token

1. Create a Personal Access Token at https://github.com/settings/tokens
2. Use the token as your password when prompted:

```bash
git push https://<YOUR_TOKEN>@github.com/maddox-bayn/idlang.git main
```

## Option 3: Push via SSH (If you have SSH set up)

Change the remote URL to use SSH:

```bash
git remote set-url origin git@github.com:maddox-bayn/idlang.git
git push origin main
```

## Option 4: Use GitHub Desktop

1. Open GitHub Desktop
2. It will show the staged changes
3. Commit the changes
4. Click "Publish repository" or "Push origin"

---

## After Pushing

Once the code is on GitHub, you can:

1. **Deploy to Vercel** (Fastest for frontend):
   - Go to https://vercel.com/new
   - Import your repository
   - Set `VITE_API_URL` environment variable
   - Click Deploy

2. **Deploy to Netlify**:
   - Connect GitHub repository
   - Build command: `npm run build`
   - Publish directory: `dist`

3. **Deploy with Docker**:
   ```bash
   docker-compose up -d --build
   ```

## Current State

All changes have been committed to your local branch:
- 29 files changed
- 4,748 insertions
- 277 deletions

The commit message is:
```
feat: Rebuild Idlang MVP with NMT, STT, TTS and 3 translation modes
```
