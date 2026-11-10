// The data that engine/studio.py gives to the window, as the `status` and `talks` commands print it.
// If you change the output of the engine, change these types and tests/test_studio.py.

/** A video of a slide: the part of the slide between two pauses. */
interface SlidePart {
  /** The path of the video for the local server of the app, for example `/file/<talk>/…mp4`. */
  url: string;
  /** True if the part plays again and again until the next pause. */
  loop?: boolean;
}

type SlideStatus = 'new' | 'changed' | 'transition' | 'resolution' | 'rendered' | 'off';
type ReviewStatus = '' | 'approved' | 'changes';

interface SlideReview {
  status: ReviewStatus;
  note?: string;
  /** True if the code changed after the approval. */
  stale?: boolean;
}

interface Slide {
  name: string;
  title: string;
  /** The line of `main.py` that adds the slide. */
  line: number;
  /** False if the line is a comment: the slide is not in the talk. */
  active: boolean;
  status: SlideStatus;
  review: SlideReview;
  parts: SlidePart[];
  thumbnail?: string;
  /** The resolution of the slide, if it is different from the resolution of the talk. */
  resolution?: string;
}

interface TalkStatus {
  talk: string;
  title: string;
  slides: Slide[];
  [key: string]: unknown;
}

interface TalkEntry {
  id: string;
  title: string;
  path: string;
  /** True if the folder of the talk is not there. */
  missing?: boolean;
}

type JobStatus = 'queued' | 'running' | 'ok' | 'error' | 'cancelled';

/** A render or an export in the queue of the app (studio_engine::jobs::Summary). */
interface Job {
  id: number;
  talk: string;
  title: string;
  status: JobStatus;
  log: string[];
}

/** What the `info` command gives when the window starts. */
interface AppInfo {
  port: number | null;
  root: string;
  home: string | null;
  claude: string | null;
  uv: boolean;
  install: string;
  version: string;
}
