(() => {
  const timeZone = 'America/Los_Angeles';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const partsAt = (epochMs) => Object.fromEntries(
    formatter.formatToParts(new Date(epochMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  const pacificEpoch = (date, time) => {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
    if (!dateMatch || !timeMatch) return null;

    const target = {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
      second: 0
    };
    if (target.month < 1 || target.month > 12 || target.day < 1 || target.day > 31
      || target.hour > 23 || target.minute > 59) return null;

    const wallClockMs = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      0
    );
    let candidate = wallClockMs;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const shown = partsAt(candidate);
      const shownAsUtc = Date.UTC(
        shown.year,
        shown.month - 1,
        shown.day,
        shown.hour,
        shown.minute,
        shown.second
      );
      candidate += wallClockMs - shownAsUtc;
    }

    const verified = partsAt(candidate);
    const matches = Object.entries(target).every(([key, value]) => verified[key] === value);
    return matches ? Math.floor(candidate / 1000) : null;
  };

  globalThis.RegalEventTime = Object.freeze({ pacificEpoch, timeZone });
})();
