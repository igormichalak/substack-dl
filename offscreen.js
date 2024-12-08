const port = chrome.runtime.connect(null, {
    name: 'offscreen',
});

port.onMessage.addListener(async req => {
    if (req.type !== 'processSegments') return;

    const segmentUrls = req.segmentUrls;
    let completedSegments = 0;
    let lastTimeReported = 0;
    const concurrencyLimit = 4;
    const queue = segmentUrls.map((url, idx) => ({ url, idx }));

    const reportProgress = force => {
        const progress = 0.05 + 0.95 * (completedSegments / segmentUrls.length);
        const shouldReport = !!force || (Date.now() - lastTimeReported >= 1000);
        if (shouldReport) {
            port.postMessage({ type: 'downloadStatus', progress });
            lastTimeReported = Date.now();
        }
    };

    async function* downloadQueue() {
        while (queue.length > 0) {
            const { url, idx } = queue.shift();
            yield fetch(url, { credentials: 'include' })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch segment: ${url}`);
                    }
                    return response.arrayBuffer();
                })
                .then(arrayBuffer => {
                    completedSegments++;
                    reportProgress();
                    return { buf: arrayBuffer, idx };
                });
        }
    }

    const workers = Array.from({ length: concurrencyLimit }, async () => {
        const results = [];
        for await (const iab of downloadQueue()) {
            results.push(iab);
        }
        return results;
    });

    reportProgress(true);
    const indexedArrayBuffers = (await Promise.all(workers)).flat();
    reportProgress(true);

    indexedArrayBuffers.sort(({ idx: a }, { idx: b }) => a - b);

    const totalLength = indexedArrayBuffers
        .reduce((acc, { buf }) => acc + buf.byteLength, 0);

    const merged = new Uint8Array(totalLength);
    let offset = 0;

    for (const { buf } of indexedArrayBuffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
    }

    const blob = new Blob([merged.buffer], { type: 'video/mp2t' });
    const downloadUrl = URL.createObjectURL(blob);

    port.postMessage({ type: 'videoReady', videoUrl: req.videoUrl, downloadUrl });
});
