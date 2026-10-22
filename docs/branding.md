# Job Copilot branding

The selected logo is the **first generated design**: a violet J-shaped path with
an upward turn. Keep its colors, silhouette and transparency intact.

![Job Copilot logo](../frontend/src/assets/job-copilot-logo.png)

- Source artwork: `frontend/src/assets/job-copilot-logo.png`.
- Dashboard: React imports the artwork; Vite emits its asset URL and favicon.
- Legacy dashboard: `/static/branding/job-copilot-logo.png`.
- Extension source: `extension/public/icons/job-copilot.png`; WXT copies it into
  the package. The same high-resolution PNG backs Chrome's icon size entries;
  Chrome scales it for the requested display size.
- Popup: the icon is paired with readable Job Copilot text. Decorative images
  have empty alt text so screen readers do not repeat the adjacent name.

Build the dashboard with `cd frontend && npm run build`. Build/sync the existing
unpacked extension with `cd extension && npm run build:unpacked`, then reload it
at `chrome://extensions`. No extension permissions are added by this branding.

Generation method: built-in image_gen. This is raster artwork, not a vector file.
