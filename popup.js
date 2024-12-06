document.addEventListener('DOMContentLoaded', async () => {
    const videosContainer = document.getElementById('videos-container');

    const tab = await getCurrentTab();
    if (!tab) {
        videosContainer.innerText = 'No tab found.';
        return;
    }

    chrome.runtime.sendMessage({ type: 'getVideosForTab', tabId: tab.id }, response => {
        const videos = (response && response.videos) || [];
        if (videos.length === 0) {
            videosContainer.innerText = 'No video intercepted.';
            return;
        }
        videos.forEach((video, idx) => {
            const div = document.createElement('div');
            div.className = 'video-item';

            const urlDiv = document.createElement('div');
            urlDiv.className = 'video-url';
            urlDiv.innerText = video.url;

            const dlButton = document.createElement('button');
            dlButton.innerText = 'Download M3U8';
            dlButton.addEventListener('click', () => {
                chrome.downloads.download({
                    url: video.url,
                    filename: `video_${idx}.m3u8`,
                    saveAs: true,
                });
            });

            div.appendChild(urlDiv);
            div.appendChild(dlButton);
            videosContainer.appendChild(div);
        });
    });
});

async function getCurrentTab() {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}
