# Third-party notices

## D3 7.9.0

The vendored `vendor/d3.min.js` is the official D3 7.9.0 distribution from:

https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js

D3 is Copyright 2010–2023 Mike Bostock and is distributed under the ISC license. The complete license is in [vendor/D3-LICENSE](vendor/D3-LICENSE).

The file is byte-identical to `dist/d3.min.js` of the npm package `d3@7.9.0`. Its SHA-256 is:

```
f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539
```

The unit tests pin this hash, so a change to the vendored file is a visible, reviewed change.

## Development tools, not distributed

The test tooling is used only to develop and check the explorer. None of it is in `index.html`, in `vendor/`, or in the Docker image, and none of it is copied to the host by the deploy.

- `@playwright/test`, `playwright` and `playwright-core` 1.63.0 (Apache-2.0), pinned exactly in `package.json` and `package-lock.json`.
- The Chrome for Testing build that this Playwright version downloads to run the browser tests. It is fetched by `npx playwright install chromium` on the machine that runs the tests, not committed and not redistributed here.

No code from these tools is copied into the repository. Any third-party code that is copied in later needs its own notice in the same change.
