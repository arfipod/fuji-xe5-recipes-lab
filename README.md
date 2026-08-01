# Fuji X-E5 Recipes Lab

This draft branch contains the initial research prototype as a checksum-verified source archive while the repository bootstrap is being finalized.

## Expand the source tree locally

```bash
git clone --branch feat/initial-research-prototype \
  https://github.com/arfipod/fuji-xe5-recipes-lab.git
cd fuji-xe5-recipes-lab
bash bootstrap.sh
npm ci
npm run verify
npm start
```

Open `http://127.0.0.1:4173` in a Chromium-based browser.

The bootstrap script verifies SHA-256 before extraction. It expands the complete English-only source tree, including architecture and protocol documentation, parser/editor UI, mock camera, experimental X-E5 USB codecs, tests, and CI configuration.

## Safety status

- This is a research prototype.
- No physical X-E5 write has been validated yet.
- Start with read-only discovery, then C7, then FS3.
- Keep a known-good official full camera backup.
- Auto ISO and exposure compensation are reminders in the first writer.
- The draft pull request must not be merged until the source tree is expanded in GitHub and CI is green.

See the full README after expansion for the complete feature and validation status.
