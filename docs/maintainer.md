---
layout: page
title: 미니캐스트 개발자
description: 미니캐스트 개발자
---

<script setup>
import {
  VPTeamPage,
  VPTeamMembers
} from 'vitepress/theme'

const developer = [
  {
    avatar: 'https://avatars.githubusercontent.com/u/110483588?v=4',
    name: '안동민',
    title: '개발자',
    desc: '미니캐스트 확장 개발 및 유지보수',
    links: [
      { icon: 'github', link: 'https://github.com/andongmin94' },
    ]
  }
]
</script>

<VPTeamPage>
  <VPTeamMembers :members="developer" />
</VPTeamPage>