# Vite / FastAPI Asset Routing Rule

When generating Vite applications that are served by a FastAPI backend from a mounted `/static/` folder:
1. Ensure `base: '/static/'` is in `vite.config.js`.
2. Ensure any post-deploy shell scripts that validate the build output check for `"/static/assets/"` instead of strictly `"/assets/"`.
