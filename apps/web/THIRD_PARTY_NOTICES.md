# Third-party notices — apps/web

Material the web app sends to the browser beyond its npm dependencies' bundled JavaScript. The full license texts go
with the files: `public/vendor/LICENSES-zxing.txt`, served at `/vendor/LICENSES-zxing.txt`.

## Camera barcode reader (ADR-0025)

- `barcode-detector` 3.2.3 (https://github.com/Sec-ant/barcode-detector) — MIT, Copyright (c) 2023 Ze-Zheng Wu. A
  ponyfill of the `BarcodeDetector` API, loaded by `import()` only when the camera window opens on a browser without a
  native detector.
- `zxing-wasm` 3.1.6 (https://github.com/Sec-ant/zxing-wasm) — MIT for its JavaScript, Copyright (c) 2023 Ze-Zheng Wu.
- `zxing_reader.wasm` of `zxing-wasm` 3.1.6 — zxing-cpp (commit `2c3dcfeffa7878950a58c1703c86774a428b0c91`,
  https://github.com/zxing-cpp/zxing-cpp) and `src/cpp/ZXingWasm.cpp` of zxing-wasm compiled to WebAssembly — Apache
  License 2.0, Copyright 2016 Nu-book Inc., 2023 Axel Waggershauser, 2023 Ze-Zheng Wu. Copied from the package by
  `tools/scripts/zxing-wasm.mjs` into `public/vendor/zxing_reader-3.1.6.wasm` (not in git), checked against the
  package's SHA-256. zxing-cpp has no NOTICE file.
