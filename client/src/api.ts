import type {
  AiProvider, Background, BackgroundLook, Brand, DefaultSettings, FitMode, Job, JobPart, JobSettings, JobStatus, LogEntry, LogLevel, SourceInfo, Step, Style, SystemStatus,
  SummaryClip, SummaryResult, SummarySettings, VideoFormat, Voice,
} from "../../server/types";

export type {
  AiProvider, Background, BackgroundLook, Brand, DefaultSettings, FitMode, Job, JobPart, JobSettings, JobStatus, LogEntry, LogLevel, SourceInfo, Step, Style, SystemStatus,
  SummaryClip, SummaryResult, SummarySettings, VideoFormat, Voice,
};

export interface Meta {
  voices: Voice[];
  steps: Step[];
  geminiConfigured: boolean;
  geminiModel: string;
  whisperModel: string;
  system: SystemStatus;
}

export interface JobDetail {
  job: Job;
  transcript: string | null;
  script: string | null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Lỗi ${res.status}`);
  return data as T;
}

/** Multipart upload with progress (fetch cannot report upload progress). */
function upload<T>(url: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const data = (() => {
        try { return JSON.parse(xhr.responseText); } catch { return {}; }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new Error(data.error ?? `Lỗi ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối tới server"));
    xhr.send(form);
  });
}

export const api = {
  meta: (recheck = false) => request<Meta>("GET", `/api/meta${recheck ? "?recheck=1" : ""}`),

  jobs: () => request<Job[]>("GET", "/api/jobs"),
  job: (id: string) => request<JobDetail>("GET", `/api/jobs/${id}`),
  createJob: (file: File, title: string, settings: JobSettings, onProgress: (f: number) => void) => {
    const form = new FormData();
    form.append("media", file);
    form.append("title", title);
    form.append("settings", JSON.stringify(settings));
    return upload<Job>("/api/jobs", form, onProgress);
  },
  createJobFromUrl: (url: string, title: string, settings: JobSettings) =>
    request<Job>("POST", "/api/jobs", { url, title, settings }),
  createJobFromTopic: (topic: { prompt: string; minMinutes: number; maxMinutes: number }, title: string, settings: JobSettings) =>
    request<Job>("POST", "/api/jobs", { topic, title, settings }),
  probeSource: (url: string) => request<SourceInfo>("POST", "/api/sources/probe", { url }),
  saveScript: (id: string, script: string) => request<Job>("PUT", `/api/jobs/${id}/script`, { script }),
  continueJob: (id: string) => request<Job>("POST", `/api/jobs/${id}/continue`),
  rerun: (id: string, fromStep?: Step, settings?: JobSettings) =>
    request<Job>("POST", `/api/jobs/${id}/rerun`, { fromStep, settings }),
  stop: (id: string) => request<Job>("POST", `/api/jobs/${id}/stop`),
  renameJob: (id: string, title: string) => request<Job>("PATCH", `/api/jobs/${id}`, { title }),
  deleteJob: (id: string) => request<void>("DELETE", `/api/jobs/${id}`),

  createSummary: (file: File, captions: File | null, title: string, settings: SummarySettings, onProgress: (f: number) => void) => {
    const form = new FormData();
    form.append("media", file);
    if (captions) form.append("captions", captions);
    form.append("title", title);
    form.append("settings", JSON.stringify(settings));
    return upload<Job>("/api/summaries", form, onProgress);
  },
  createSummaryFromUrl: (url: string, title: string, settings: SummarySettings) =>
    request<Job>("POST", "/api/summaries", { url, title, settings }),
  rerunSummary: (id: string, fromStep: Step, summary?: SummarySettings) =>
    request<Job>("POST", `/api/jobs/${id}/rerun`, { fromStep, summary }),

  defaults: () => request<DefaultSettings>("GET", "/api/defaults"),
  saveDefaults: (defaults: DefaultSettings) => request<DefaultSettings>("PUT", "/api/defaults", defaults),
  summaryDefaults: () => request<SummarySettings>("GET", "/api/summary-defaults"),
  saveSummaryDefaults: (defaults: SummarySettings) => request<SummarySettings>("PUT", "/api/summary-defaults", defaults),
  numbering: () => request<{ tag: string; next: number }>("GET", "/api/numbering"),
  saveNumbering: (n: { tag: string; next: number }) => request<{ tag: string; next: number }>("PUT", "/api/numbering", n),

  brand: () => request<Brand>("GET", "/api/brand"),
  saveBrand: (brand: Brand) => request<Brand>("PUT", "/api/brand", brand),

  styles: () => request<Style[]>("GET", "/api/styles"),
  createStyle: (name: string, prompt: string) => request<Style>("POST", "/api/styles", { name, prompt }),
  updateStyle: (id: string, name: string, prompt: string) => request<Style>("PUT", `/api/styles/${id}`, { name, prompt }),
  deleteStyle: (id: string) => request<void>("DELETE", `/api/styles/${id}`),

  backgrounds: () => request<Background[]>("GET", "/api/backgrounds"),
  uploadBackground: (file: File, name: string, onProgress: (f: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    return upload<Background>("/api/backgrounds", form, onProgress);
  },
  updateBackground: (id: string, patch: BackgroundLook) => request<Background>("PATCH", `/api/backgrounds/${id}`, patch),
  deleteBackground: (id: string) => request<void>("DELETE", `/api/backgrounds/${id}`),
};

export const jobFileUrl = (jobId: string, path: string) => `/files/jobs/${jobId}/${path}`;
export const backgroundUrl = (file: string) => `/files/backgrounds/${file}`;
export const voicePreviewUrl = (voice: string, rate: string) =>
  `/api/voices/preview?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}`;
