# Model weights

VISION AI loads its weights from `VITE_MODEL_PATH` (default `/models`)
**first**, and falls back to public CDNs when local files are missing. Drop
files here to make the app fully offline-capable.

## Detection / landmarks / age-gender (face-api.js)

Required files (from the `face-api.js` weights repository):

```
tiny_face_detector_model-weights_manifest.json
tiny_face_detector_model-shard1
face_expression_model-weights_manifest.json      # FER fallback only
face_expression_model-shard1                     # FER fallback only
face_landmark_68_tiny_model-weights_manifest.json
face_landmark_68_tiny_model-shard1
age_gender_model-weights_manifest.json
age_gender_model-shard1
```

Fetch from: https://github.com/justadudewhohacks/face-api.js/tree/master/weights

## High-accuracy emotion model (HSEmotion, recommended)

The **primary** emotion engine is the HSEmotion AffectNet ONNX model
(EfficientNet-B0, 8 classes, ~87% accuracy vs ~65% for FER2013):

```
emotion/enet_b0_8_best_afew.onnx
```

Download from: https://github.com/av-savchenko/face-emotion-recognition
(see the repository's model links; the file is ~30 MB)

When this file is present, VISION AI:

- skips the FER2013 download entirely (saves ~300 KB per session),
- classifies with the AffectNet model, including the 8th class **Contempt**,
- preprocesses crops exactly per the model's recipe (224×224, ImageNet
  mean/std normalization, NCHW).

When the file is **absent**, the app fast-fails this engine (a single HEAD
request) and automatically uses the FER2013 fallback — every feature still
works, at lower accuracy. The onnxruntime-web WASM runtime itself is fetched
from a pinned jsDelivr CDN, so no additional setup is required either way.

> Verify the model after placing it: the app runs a zero-tensor self-test at
> load and falls back automatically if the file is corrupt or emits the wrong
> number of classes.
