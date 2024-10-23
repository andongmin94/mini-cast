---
layout: page
title: 미니캐스트 개발자
description: 미니캐스트 개발자
---

<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamPageSection,
  VPTeamMembers
} from 'vitepress/theme'

const developer = [
  {
    avatar: 'https://avatars.githubusercontent.com/u/110483588?v=4',
    name: '안동민',
    title: 'Developer',
    desc: 'A knight of Information processing.',
    links: [
      { icon: 'github', link: 'https://github.com/andongmin94' },
    ]
  }
]
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>미니캐스트 개발자</template>
  </VPTeamPageTitle>
  <VPTeamMembers :members="developer" />
</VPTeamPage>