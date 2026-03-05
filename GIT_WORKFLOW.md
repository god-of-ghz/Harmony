# Git Workflow for Harmony

Now that your project is connected to GitHub, here is a quick cheat sheet for your day-to-day version control tasks!

## Saving Your Work (Committing & Pushing)

When you have made changes to your code and want to save them to version control:

1. **Check what has changed:**
   ```bash
   git status
   ```

2. **Stage your changes (prepare them to be saved):**
   ```bash
   git add .
   ```
   *(This stages all new, modified, and deleted files. You can replace `.` with a specific file path to only stage certain files).*

3. **Commit your changes (save them locally with a message):**
   ```bash
   git commit -m "Brief description of what you changed"
   ```

4. **Push your changes to GitHub (upload to the internet):**
   ```bash
   git push origin main
   ```

## Pulling Updates

If you make changes directly on GitHub or someone else contributes to your project, you'll need to pull those updates down to your computer:

```bash
git pull origin main
```

## Creating Branches for New Features

It's highly recommended to do new feature work on a separate branch instead of directly on `main`:

1. **Create and switch to a new branch:**
   ```bash
   git checkout -b my-new-feature
   ```

2. **Do your work, then add and commit your changes as usual.**

3. **Push the new branch to GitHub:**
   ```bash
   git push -u origin my-new-feature
   ```

4. **Merge the branch into `main`:**
   Once the feature is finished and tested, you can create a Pull Request on GitHub to merge it into `main`, or do it locally:
   ```bash
   git checkout main
   git merge my-new-feature
   git push origin main
   ```
