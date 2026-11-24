# Gallery video upload with on-device compression

Goal: on New Job, worker can pick an existing video from the gallery; it is compressed in-browser (WebCodecs via mediabunny) and attached as the job's condition video, next to the existing in-app recorder.

Decisions: keep recorder + add gallery pick; on compression failure block video but job stays submittable; reject >2 min before encoding; output H.264 MP4, max 1080p, 4 Mbps, no audio (<75MB); recorder VIDEO_BITRATE 3->4 Mbps; add `mediabunny` dependency, dynamically imported; progress bar + Cancel + wake lock, submit disabled while compressing.
Defaults: Worker unchanged (75MB cap, sniffing); always re-encode; browser-only; strings in en/ru/he; update CONTEXT.md.
Out of scope: server transcoding, audio, >2 min, background upload, retention change.

AC-1 "choose from gallery" next to recorder, accepts video files.
AC-2 >2 min rejected before encoding, localized message.
AC-3 valid clip -> H.264 MP4, <=1080p, ~4 Mbps, no audio, <75MB.
AC-4 progress + Cancel during compression; submit disabled until done/cancelled.
AC-5 WebCodecs/encode failure -> localized error, job still submittable without video.
AC-6 recorder uses same 4 Mbps target.
AC-7 picked video goes through existing upload queue and /upload unchanged.
AC-8 tests cover size/duration checks and failure path; web + worker checks pass.
