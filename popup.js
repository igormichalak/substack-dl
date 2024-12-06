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

        const buttons = [];

        for (const video of videos) {
            const div = document.createElement('div');
            div.className = 'video-item';

            const urlDiv = document.createElement('div');
            urlDiv.className = 'video-url';
            urlDiv.innerText = video.url;

            const dlButton = document.createElement('button');
            dlButton.innerText = 'Download';
            dlButton.addEventListener('click', () => {
                for (const button of buttons) {
                    button.disabled = true;
                }
                chrome.runtime.sendMessage({ type: 'downloadVideo', video }, () => {
                    for (const button of buttons) {
                        button.disabled = false;
                    }
                });
            });

            div.appendChild(urlDiv);
            div.appendChild(dlButton);
            videosContainer.appendChild(div);

            buttons.push(dlButton);
        }
    });

    const progressBar = document.getElementById('progress-bar');

    const port = chrome.runtime.connect(null, {
        name: 'popup',
    });

    port.onMessage.addListener(req => {
        if (req.type !== 'downloadStatus') return;
        progressBar.style.transform = `scaleX(${req.progress.toFixed(2)})`;
    });
});

async function getCurrentTab() {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}
