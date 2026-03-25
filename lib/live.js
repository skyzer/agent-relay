const streams = new Map();

function subscribe(jobId, res) {
  if (!streams.has(jobId)) {
    streams.set(jobId, new Set());
  }
  streams.get(jobId).add(res);
}

function unsubscribe(jobId, res) {
  const set = streams.get(jobId);
  if (!set) {
    return;
  }
  set.delete(res);
  if (set.size === 0) {
    streams.delete(jobId);
  }
}

function emit(jobId, event) {
  const set = streams.get(jobId);
  if (!set) {
    return;
  }
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}

module.exports = {
  subscribe,
  unsubscribe,
  emit,
};
