/**
 * Central configuration. Tunables come from environment variables so they
 * are never hardcoded at call sites; each has a safe fallback.
 */
import { Emotion, type EmotionMeta } from '@/types/emotion'

/**
 * Parse a positive number from an environment variable, silently falling
 * back when the variable is missing or malformed. Configuration values must
 * never crash the app — they can only degrade it, so an unreadable value
 * should mean 'use the default', not 'white screen'.
 */
function readNumberEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const env = import.meta.env

/**
 * Target detection rate. Detection is budget-limited to this rate and the
 * frames in between are filled by velocity coasting (see useFaceDetection),
 * so a missed budget degrades box smoothness slightly — never correctness.
 */
export const DETECTION_FPS = readNumberEnv(env.VITE_DETECTION_FPS, 24)

/**
 * Overlay (bounding box) publish rate. Boxes must move at display speed to
 * look smooth, but they are cheap to render — unlike the stats/comparison
 * panels, which are published at the slower UI_UPDATE_MS rate.
 */
export const FACES_UPDATE_MS = 33 // ~30 Hz
/** Hard cap on simultaneously tracked faces. */
export const MAX_FACES = readNumberEnv(env.VITE_MAX_FACES, 5)
/** EMA / alpha-beta position gain. */
export const SMOOTHING_ALPHA = readNumberEnv(env.VITE_SMOOTHING_ALPHA, 0.35)
/** Where the model weights live. */
export const MODEL_PATH = env.VITE_MODEL_PATH ?? '/models'

/** UI refresh rate — the eye can't resolve bar changes faster than this. */
export const UI_UPDATE_FPS = 10
export const UI_UPDATE_MS = 1000 / UI_UPDATE_FPS

/* ── Oriented bounding box (landmark-anchored HUD) ────────────── */
/** Horizontal margin applied to the landmark hull extent. */
export const OBB_WIDTH_MARGIN = 1.22
/** Vertical margin applied to the landmark hull extent. */
export const OBB_HEIGHT_MARGIN = 1.25
/**
 * iBUG-68 has no forehead landmarks — the brows are the topmost points —
 * so the hull is extended upward by this fraction of the eye→chin span to
 * reach the hairline. Derived from facial canon: brow→hairline is roughly
 * one third of brow→chin.
 */
export const OBB_FOREHEAD_EXTENSION = 0.38
/** Bracket arm length as a fraction of the box's shorter side. */
export const HUD_BRACKET_RATIO = 0.2

/* ── Tracking ─────────────────────────────────────────────────── */
/**
 * Adaptive position gain. A fixed alpha has to choose between jitter (high)
 * and lag (low); interpolating on normalized velocity gets both — a still
 * face is smoothed hard, a fast-moving one tracks tightly.
 */
export const ALPHA_STILL = 0.18
export const ALPHA_FAST = 0.55
/**
 * Velocity (in face-widths per second) at which the gain reaches
 * ALPHA_FAST. Normalizing by face width makes the response identical
 * whether the subject is near the camera or far from it.
 */
export const VELOCITY_FULL_RESPONSE = 1.5

export const VELOCITY_GAIN = 0.2
export const SIZE_ALPHA = 0.2
export const SIZE_VELOCITY_GAIN = 0.05
/** Frames a track may go unmatched before it is retired. */
export const MAX_MISSED_FRAMES = 15
export const OCCLUSION_FADE_MS = 320
/* ── Face preprocessing (accuracy) ────────────────────────────── */
/**
 * Anatomical expansion applied around the face box before cropping — 20% on
 * each edge (a 1.40x box), guaranteeing chin, jawline, forehead and mouth
 * corners are all enclosed. The classifier was trained on generously framed
 * crops, so a tight box is out-of-distribution input.
 */
export const CROP_PADDING_RATIO = 0.18
/**
 * Square crop size fed to the emotion classifier and age-gender nets.
 * 224 is the HSEmotion input requirement; the FER fallback net resizes
 * internally, so one size serves both engines.
 */
export const FACE_CROP_SIZE = 224

/**
 * Path (or full URL) of the high-accuracy HSEmotion AffectNet ONNX model.
 * When the file is absent the app fast-fails this engine (one HEAD request)
 * and falls back to the built-in FER2013 classifier.
 */
export const EMOTION_MODEL_PATH =
  env.VITE_EMOTION_MODEL_PATH ?? '/models/emotion/enet_b0_8_best_afew.onnx'
/** Below this mean luminance the crop is contrast-equalized. */
export const LUMINANCE_DARK = 50
/** Above this mean luminance the crop is contrast-equalized. */
export const LUMINANCE_BRIGHT = 210
/** Histogram clip height as a multiple of the uniform bin height. */
export const HISTOGRAM_CLIP_LIMIT = 3

/* ── Temporal filtering (stability) ───────────────────────────── */
/** Readings retained in the weighted smoothing window (~7 = ~230 ms at 30 Hz). */
export const TEMPORAL_WINDOW_SIZE = 7
/**
 * Exponential weight base: each newer reading is this much more
 * influential than the one before it. With a full 7-reading window, 1.0
 * would lag noticeably; 1.28 gives the newest frame ~28% of the weight —
 * close to the α=0.28 the smoothing spec targets, while the window still
 * absorbs single-frame spikes entirely. Effective lag ≈ 1.9 readings.
 */
export const TEMPORAL_WEIGHT_BASE = 1.65
/** A challenger must beat the incumbent by this margin to take over. */
export const HYSTERESIS_MARGIN = 0.14
/** ...and hold that margin for this many consecutive readings. */
export const HYSTERESIS_FRAMES = 3

/**
 * Minimum smoothed probability for an emotion to be displayed at all.
 *
 * Per-class rather than global because the classes are not equally
 * reliable: Neutral is the resting state and should win easily, while
 * Surprise/Fear are visually similar to each other and to Happy, so they
 * must clear a higher bar before overriding a stable label. An emotion
 * below its threshold can never take the display lock.
 */
/**
 * Activation floor applied uniformly to every class.
 *
 * Previously these were per-class (Happy/Angry 0.48, Surprise/Fear 0.55,
 * Contempt 0.60). That spread was the second half of the output-collapse
 * bug: HSEemotion rarely emits >0.55 for anything but an extreme
 * expression, so Fear, Disgust and Contempt could never clear their floors
 * and silently fell back to Neutral. A single floor keeps the weak-signal
 * fallback (a genuinely uncertain frame still reads Neutral) without
 * starving any individual class.
 */
export const EMOTION_CONFIDENCE_FLOOR = 0.35

export const EMOTION_THRESHOLDS: Record<Emotion, number> = {
  [Emotion.Neutral]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Happy]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Sad]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Angry]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Surprised]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Fearful]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Disgusted]: EMOTION_CONFIDENCE_FLOOR,
  [Emotion.Contempt]: EMOTION_CONFIDENCE_FLOOR,
}
/**
 * Resting-face baseline capture window. 1.5 s ≈ 45 frames at a 30 Hz
 * detection rate, assuming a relaxed face while the session settles.
 */
export const CALIBRATION_MS = 1500
/**
 * Fraction of the captured baseline subtracted from later readings. Only a
 * partial subtraction: removing all of it would erase genuine expressions
 * of an emotion the user happens to rest near, 40% corrects the bias while
 * keeping real expressions clearly detectable.
 */
export const BASELINE_SUBTRACT_RATIO = 0.4

/* ── Dual-engine ensemble (geometric verification) ─────────────── */
/**
 * Ensemble weights. The CNN carries most of the signal; geometry is a
 * verifier that confirms or vetoes, not a primary classifier — the
 * landmark ratios cannot distinguish, say, Sad from Fear on their own.
 */
export const FUSION_CNN_WEIGHT = 0.65
export const FUSION_GEOMETRIC_WEIGHT = 0.35

/** R_smile above this indicates genuinely raised mouth corners. */
export const SMILE_RATIO_POSITIVE = 0.38
/** R_smile below this indicates downturned corners. */
export const SMILE_RATIO_NEGATIVE = 0.22
/** Geometric boost applied to Happy when the mouth is genuinely smiling. */
export const SMILE_BOOST = 0.4
/** Geometric boost applied to Sad for downturned corners. */
export const SAD_BOOST = 0.35
/** Inner-brow gap below this fraction of eye width = brows pulled together. */
export const BROW_COMPRESSION_THRESHOLD = 0.18
/** Geometric boost applied to Angry for compressed brows. */
export const ANGRY_BOOST = 0.45
/** Mouth-aperture and eye-aspect thresholds for the Surprise / Fear verifiers. */
export const MAR_SURPRISE = 0.5
export const EAR_SURPRISE = 0.32
export const MAR_FEAR = 0.35
export const EAR_FEAR = 0.18
export const SURPRISE_BOOST = 0.5
export const FEAR_BOOST = 0.4
/** Nose-bridge→upper-lip gap must contract by more than this vs resting. */
export const NOSE_CONTRACTION_RATIO = 0.18
export const DISGUST_BOOST = 0.45

/** Gating: reject a confident CNN call when the face contradicts it. */
export const GATE_HAPPY_CNN = 0.7
export const GATE_HAPPY_SMILE_MAX = 0.25
export const GATE_ANGRY_CNN = 0.65
export const GATE_ANGRY_BROW_MIN = 0.22


/* ── Animated-content adaptation ───────────────────────────────── */
/**
 * Softmax temperature for animated/cartoon media.
 *
 * Out-of-domain (non-photorealistic) faces make the model produce flat,
 * uncertain distributions that fall below the confidence floor and read as
 * Neutral. T < 1 sharpens the distribution — dividing logits by 0.7 widens
 * the gaps between classes, so a genuine (if weak) winner clears the floor.
 *
 * Applied ONLY when the user enables animated-content mode: on photographic
 * faces the model is already confident, and sharpening would push borderline
 * WRONG predictions over the floor too, degrading real-video accuracy.
 */
export const ANIMATED_TEMPERATURE = 0.7

/* ── Tiered inference schedule ────────────────────────────────── */
/** Emotion runs every Nth detection frame (2 → ~15 Hz at 30 Hz detect). */
export const EMOTION_FRAME_INTERVAL = 2

/** Boxes overlapping more than this are treated as the same face. */
/**
 * Box-merge IoU threshold. Two boxes sharing 30% or more of their area are
 * the same physical face — keep only the higher-confidence one and never
 * draw both. Deliberately aggressive: two DISTINCT faces side by side
 * overlap by well under 10%, so a low threshold merges duplicates without
 * ever collapsing genuine neighbours.
 */
export const NMS_IOU_THRESHOLD = 0.3
/**
 * Reject any face candidate the detector scores below 65%. Well-lit
 * Selfie-distance faces typically score 0.85–0.99, so a strict 0.65 bar
 * filters background artifacts (shirts, shadows, screens) while keeping
 * every genuine face in the primary use case.
 */
export const DETECTION_SCORE_THRESHOLD = 0.65
/**
 * Minimum face size, both interpreted strictly: a box must be at least
 * `MIN_FACE_SIZE_PX` on each side AND at least `MIN_FACE_FRAME_FRACTION`
 * of the frame width. Measured in SOURCE frame pixels, so the rule is
 * resolution-independent. Eliminates micro-detections on background
 * objects that survive the score threshold.
 */
export const MIN_FACE_SIZE_PX = 80
export const MIN_FACE_FRAME_FRACTION = 0.08

/* ── Emotion analysis ─────────────────────────────────────────── */
/** Rolling window used for mode smoothing of the dominant emotion. */
export const MODE_WINDOW_SIZE = 5
/** A new dominant emotion must hold this long to count as a transition. */
export const TRANSITION_STABLE_MS = 1000
/** ...and for at least this many consecutive frames. */
export const TRANSITION_MIN_FRAMES = 3
export const SUDDEN_TRANSITION_MS = 2200
/** Window in which a second person copying an emotion counts as mirroring. */
export const MIRROR_WINDOW_SEC = 3
/** Grace period before comparison mode reverts to single-person view. */
export const COMPARISON_GRACE_SEC = 3

/* ── Limits (memory-leak guards) ──────────────────────────────── */
export const MAX_TIMELINE_ENTRIES = 500
export const MAX_TRANSITION_ENTRIES = 100
export const MAX_STORED_SESSIONS = readNumberEnv(env.VITE_MAX_SESSIONS, 20)
export const TIMELINE_WINDOW_SAMPLES = 120 // 60 s at 2 Hz
export const MIN_SESSION_SEC = 5

/* ── Media limits ─────────────────────────────────────────────── */
/** Still-image upload limit (megabytes). */
export const MAX_UPLOAD_MB = readNumberEnv(env.VITE_MAX_UPLOAD_MB, 10)
/** Video upload limit (megabytes). */
export const MAX_VIDEO_MB = readNumberEnv(env.VITE_MAX_VIDEO_MB, 500)
export const MAX_IMAGE_BYTES = MAX_UPLOAD_MB * 1024 * 1024
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const VIDEO_SAMPLE_FPS = 5
export const LONG_VIDEO_SEC = 30 * 60

/* ── Inference resolution ─────────────────────────────────────── */
export const INPUT_SIZE: Record<'fast' | 'balanced', number> = {
  fast: 160,
  balanced: 224,
}
/** Downscale width before inference — never feed 1080p to the network. */
export const DOWNSCALE_WIDTH: Record<'fast' | 'balanced', number> = {
  fast: 320,
  balanced: 480,
}
/** Age/gender is stable, so run it once every N frames. */
export const AGE_GENDER_INTERVAL = 10
/** Luminance below this triggers the low-light warning. */
export const LOW_LIGHT_THRESHOLD = 0.3
/** Show extended guidance after this long with no detection. */
export const NO_FACE_HINT_MS = 10_000

/* ── Brand palette ────────────────────────────────────────────── */
export const COLORS = {
  primary: '#FF6B00',
  primaryDeep: '#E66000',
  primaryLight: '#FFF7ED',
  primary100: '#FFEDD5',
  /** Secondary / dark accent. */
  accent: '#1E293B',
  secondary: '#1E293B',
  canvas: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  border: '#E2E8F0',
  ink: '#0F172A',
  inkSecondary: '#64748B',
  inkMuted: '#94A3B8',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
} as const

export const EMOTION_META: Record<Emotion, EmotionMeta> = {
  [Emotion.Happy]: { key: Emotion.Happy, label: 'Happy', color: '#10B981', soft: '#ECFDF5' },
  [Emotion.Sad]: { key: Emotion.Sad, label: 'Sad', color: '#3B82F6', soft: '#EFF6FF' },
  [Emotion.Angry]: { key: Emotion.Angry, label: 'Angry', color: '#EF4444', soft: '#FEF2F2' },
  [Emotion.Surprised]: { key: Emotion.Surprised, label: 'Surprise', color: '#F59E0B', soft: '#FFFBEB' },
  [Emotion.Fearful]: { key: Emotion.Fearful, label: 'Fear', color: '#F97316', soft: '#FFF7ED' },
  [Emotion.Disgusted]: { key: Emotion.Disgusted, label: 'Disgust', color: '#8B5CF6', soft: '#F5F3FF' },
  // Contempt is a darker rose — adjacent to Angry's bright red on the wheel
  // but clearly separable in charts and overlays.
  [Emotion.Contempt]: { key: Emotion.Contempt, label: 'Contempt', color: '#BE123C', soft: '#FFF1F2' },
  [Emotion.Neutral]: { key: Emotion.Neutral, label: 'Neutral', color: '#64748B', soft: '#F8FAFC' },
}
