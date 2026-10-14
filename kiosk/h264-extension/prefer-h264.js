// YouTube picks a codec by asking the browser what it can play. Report VP8/VP9
// and AV1 as unsupported so it falls back to H.264 (avc1). The Pi 5 has no
// hardware decoder for any of these, and H.264 is by far the cheapest to decode
// in software; the Pi 4 also has a hardware H.264 decoder.
(() => {
  const BLOCKED = /vp0?[89]|av01/i;

  const wrapIsTypeSupported = (MS) => {
    if (!MS?.isTypeSupported) return;
    const original = MS.isTypeSupported.bind(MS);
    MS.isTypeSupported = (type) => (BLOCKED.test(type) ? false : original(type));
  };
  wrapIsTypeSupported(window.MediaSource);
  wrapIsTypeSupported(window.ManagedMediaSource);

  const canPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    return BLOCKED.test(type) ? '' : canPlayType.call(this, type);
  };

  const mc = navigator.mediaCapabilities;
  if (mc?.decodingInfo) {
    const decodingInfo = mc.decodingInfo.bind(mc);
    mc.decodingInfo = (config) => {
      const type = config?.video?.contentType ?? '';
      return BLOCKED.test(type)
        ? Promise.resolve({ supported: false, smooth: false, powerEfficient: false })
        : decodingInfo(config);
    };
  }
})();
