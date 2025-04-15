async function fetchLatestRelease() {
    try {
      const response = await fetch('https://api.github.com/repos/andongmin94/mini-cast/releases/latest', {
        headers: { 'User-Agent': 'Node.js' }
      });
      
      if (!response.ok) {
        throw new Error(`GitHub API 응답 오류: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // 버전 정보 추출
      const version = data.tag_name.replace('mini-cast', '');
      
      // 릴리즈 노트 내용
      const body = data.body || '';
      
      // 다운로드 URL과 파일 크기 추출
      let downloadUrl = '';
      let fileSize = 0;
      
      const windowsAsset = data.assets.find((asset: { name: string; }) => asset.name.endsWith('.exe'));
      if (windowsAsset) {
        downloadUrl = windowsAsset.browser_download_url;
        fileSize = Math.round(windowsAsset.size / 1024 / 1024); // MB 단위로 변환
      }
      
      return {
        version,
        downloadUrl,
        fileSize,
        body,
        publishedAt: data.published_at
      };
    } catch (error) {
      console.error('GitHub 릴리즈 정보 가져오기 실패:', error);
    }
  }
  
  // 모든 릴리즈 정보 가져오기
  async function fetchAllReleases() {
    try {
      const response = await fetch('https://api.github.com/repos/andongmin94/mini-cast/releases', {
        headers: { 'User-Agent': 'Node.js' }
      });
      
      if (!response.ok) {
        throw new Error(`GitHub API 응답 오류: ${response.status} ${response.statusText}`);
      }
      
      const releases = await response.json();
      
      return releases.map((release: { tag_name: string; assets: any[]; body: any; published_at: any; }) => {
        const version = release.tag_name.replace('chat-view-', '');
        
        // 다운로드 URL과 파일 크기 추출
        let downloadUrl = '';
        let fileSize = 0;
        
        const windowsAsset = release.assets.find(asset => asset.name.endsWith('.exe'));
        if (windowsAsset) {
          downloadUrl = windowsAsset.browser_download_url;
          fileSize = Math.round(windowsAsset.size / 1024 / 1024); // MB 단위로 변환
        }
        
        return {
          version,
          downloadUrl,
          fileSize,
          body: release.body || '',
          publishedAt: release.published_at
        };
      });
    } catch (error) {
      console.error('GitHub 릴리즈 정보 가져오기 실패:', error);
      return [];
    }
  }
  
  export { fetchLatestRelease, fetchAllReleases };