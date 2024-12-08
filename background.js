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

const downloadedVideos = {};

chrome.tabs.onRemoved.addListener(tabId => {
    const associatedVideos = interceptedVideos[tabId];
    if (associatedVideos) {
        for (const video of associatedVideos) {
            delete downloadedVideos[video.url];
        }
    }
});

let popupPort = null;
let offscreenPort = null;

chrome.runtime.onConnect.addListener(port => {
    switch (port.name) {
    case 'popup':
        popupPort = port;
        port.onDisconnect.addListener(() => {
            popupPort = null;
        });
        break;
    case 'offscreen':
        offscreenPort = port;
        port.onDisconnect.addListener(() => {
            offscreenPort = null;
        });
        port.onMessage.addListener(req => {
            if (req.type === 'videoReady' && req.downloadUrl) {
                downloadedVideos[req.videoUrl] = req.downloadUrl;
            } else if (req.type === 'downloadStatus' && popupPort) {
                popupPort.postMessage(req);
            }
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
    chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'download and combine all the video segments',
    });

    await new Promise(resolve => {
        const intervalId = setInterval(() => {
            if (offscreenPort) {
                clearInterval(intervalId);
                resolve();
            }
        }, 100);
    });

    offscreenPort.postMessage({
        type: 'processSegments',
        videoUrl: video.url,
        segmentUrls: video.segmentUrls,
    });

    await new Promise(resolve => {
        const intervalId = setInterval(() => {
            if (downloadedVideos[video.url]) {
                clearInterval(intervalId);
                resolve();
            }
        }, 100);
    });

    chrome.downloads.download({
        url: downloadedVideos[video.url],
        filename: `video_${Date.now()}.ts`,
        saveAs: true,
    }, () => {
        setTimeout(() => {
            chrome.offscreen.closeDocument();
        }, 60000);
    });
}
