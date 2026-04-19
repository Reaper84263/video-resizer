# Push this project to GitHub

You can publish this repo to your GitHub account in a few commands.

## Target repository

This project can be published to:

- `https://github.com/Reaper84263/video-resizer.git`

## 1) Add your GitHub repo as remote

```bash
git remote add origin https://github.com/Reaper84263/video-resizer.git
```

If `origin` already exists:

```bash
git remote set-url origin https://github.com/Reaper84263/video-resizer.git
```

## 2) Push to `main` (recommended)

Run these as separate commands:

```bash
git branch -M main
git push -u origin main
```

Do not combine commands on one line. Example of a bad command:

```bash
git push -u origin maingit push -u origin main
```

## 3) Optional: push `work` instead

```bash
git push -u origin work
```

## Notes

- HTTPS may ask for a Personal Access Token instead of password.
- SSH requires your key added to GitHub.
- In restricted environments, outbound GitHub network access can fail; in that case run the same commands locally.
