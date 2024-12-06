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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'getVideosForTab' && req.tabId !== -1) {
        const videos = interceptedVideos[request.tabId] || [];
        sendResponse({ videos });
    }
    return true;
});
