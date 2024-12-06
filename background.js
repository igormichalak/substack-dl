const m3u8ContentTypes = [
    'application/vnd.apple.mpegurl',
    'application/mpegurl',
    'application/x-mpegurl',
];
const m3u8Header = '#EXTM3U';

const interceptedVideos = {};

chrome.webRequest.onHeadersReceived.addListener(handleRequest, {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest'],
}, ['responseHeaders']);

async function handleRequest(details) {
    if (details.tabId === -1) return;

    if (!Array.isArray(details.responseHeaders)) return;
    const ct = details.responseHeaders.find(
        h => h.name.toLowerCase() === 'content-type'
    );
    if (!ct) return;

    const isM3U8 = m3u8ContentTypes.some(targetCT => ct.value.includes(targetCT));
    if (!isM3U8) return;

    const url = new URL(details.url);
    const text = await fetch(url, {
        credentials: 'include',
    }).then(res => res.text()).catch(err => null);

    if (!text || !text.startsWith(m3u8Header)) return;

    const segmentUrls = text.split('\n').filter(l => l != "" && !l.startsWith('#'));
    if (segmentUrls.length === 0) return;

    if (!interceptedVideos[details.tabId]) {
        interceptedVideos[details.tabId] = [];
    }

    const alreadyExists = interceptedVideos[details.tabId].some(
        v => v.url === details.url
    );
    if (!alreadyExists) {
        interceptedVideos[details.tabId].push({
            url: details.url,
            segmentUrls: segmentUrls,
        });
    }

    const count = interceptedVideos[details.tabId].length;
    chrome.action.setBadgeBackgroundColor({
        color: [240, 67, 36, 255],
        tabId: details.tabId,
    });
    chrome.action.setBadgeTextColor({
        color: [240, 201, 201, 255],
        tabId: details.tabId,
    });
    chrome.action.setBadgeText({
        text: String(count),
        tabId: details.tabId,
    });
}

let popupPort = null;

chrome.runtime.onConnect.addListener(port => {
    switch (port.name) {
    case 'popup':
        popupPort = port;
        port.onDisconnect.addListener(() => {
            popupPort = null;
        });
        break;
    }
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'getVideosForTab' && req.tabId !== -1) {
        const videos = interceptedVideos[req.tabId] || [];
        sendResponse({ videos });
        return false;
    } else if (req.type === 'downloadVideo' && req.video) {
        handleDownloadVideo(req.video).then(() => {
            sendResponse({ success: true });
        }).catch(err => {
            console.error(err);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
});

async function handleDownloadVideo(video) {
    const segmentUrls = video.segmentUrls;
    let completedSegments = 0;
    let lastTimeReported = 0;
    const concurrencyLimit = 4;
    const queue = [...segmentUrls];

    const reportProgress = force => {
        const progress = 0.05 + 0.95 * (completedSegments / segmentUrls.length);
        const shouldReport = !!force || (Date.now() - lastTimeReported >= 1000);
        if (shouldReport && activePort) {
            activePort.postMessage({ type: 'downloadStatus', progress });
            lastTimeReported = Date.now();
        }
    };

    async function* downloadQueue() {
        while (queue.length > 0) {
            const url = queue.shift();
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
                    return arrayBuffer;
                });
        }
    }

    const workers = Array.from({ length: concurrencyLimit }, async () => {
        const results = [];
        for await (const arrayBuffer of downloadQueue()) {
            results.push(arrayBuffer);
        }
        return results;
    });

    reportProgress(true);
    const segmentArrayBuffers = (await Promise.all(workers)).flat();
    reportProgress(true);

    console.log(segmentArrayBuffers.length);
}
