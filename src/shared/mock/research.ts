/**
 * 센터 공식 채널(j-youth.org, 네이버 블로그 j_youth, 유튜브 @중구청소년센터)에서 수집한 참고 정보.
 * 원본: docs/research/clubs.json (수집일 2026-10-17). 그 파일이 바뀌면 이 파일을 다시 만든다.
 * - 청소년 얼굴이 식별되는 이미지(showsMinorsFaces)는 제외했다.
 * - 이미지는 원격 주소 그대로이며 사용 권한은 센터 확인이 필요하다 (docs/brand-audit.md).
 */
import type { Club, MediaItem, Notice } from '../domain/types';

export const REFERENCE_COLLECTED_AT = '2026-10-17';

export const RESEARCH_CLUBS: Omit<Club, 'memberCount'>[] = [
  {
    id: 'cl-simile',
    name: '청소년운영위원회 시밀레 (제24기)',
    field: '자치활동 · 청소년 참여기구',
    summary: '센터의 시설과 프로그램을 청소년 눈높이에서 점검하고 개선안을 내는 청소년 대표 참여기구입니다.',
    description:
      "센터의 시설과 프로그램을 청소년 눈높이에서 점검하고 개선안을 내는 청소년 대표 참여기구입니다. 상·하반기 기관장 간담회에서 모니터링 결과를 직접 전달하고, 토요일 오후 '청소년 전용시간제'를 제안해 도입시킨 뒤 운영 현황을 모니터링하고 있습니다. 옥상 활용 프로그램 '스포츠 DAY', 체험 행사 '랜덤팩토리'처럼 또래를 위한 행사도 직접 기획·운영합니다.\n\n모집 안내(수집 시점): 2026 청소년 참여기구 모집: 서류 ~2026.3.13(금) 17:00, 면접 3.14(토), 연합 OT 3.21(토). 현재 진행 중인 모집 공고 없음.",
    meetingInfo: '2026.3 ~ 2027.2, 매주 토요일 10:00~12:00 (문의 02-2250-0524, 참여플랫폼조성팀)',
    target: '중구 거주 또는 중구 소재 학교 재학 9~24세 청소년',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/bbsData/1780995222_LIST.jpg',
        caption: "2026 기획프로그램 '옥상 피크닉 : 스포츠 DAY' 포스터",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6137',
        date: '2026-06-09',
      },
      {
        url: 'https://www.j-youth.org/data/bbsData/1780641947_LIST.jpg',
        caption: '청소년 전용시간제 모니터링 리포트 표지',
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6135',
        date: '2026-06-05',
      },
    ],
    activities: [
      {
        date: '2026-06-09',
        title: "기획프로그램 '옥상 피크닉 : 스포츠 DAY' 후기 (행사 5.23)",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6137',
      },
      {
        date: '2026-06-05',
        title: '청소년 전용시간제 모니터링 리포트',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6135',
      },
      {
        date: '2026-02-14',
        title: '청소년전용시간제 운영 안내 (매주 토 14:00~18:30, 1~3층 9~24세 전용)',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6082',
      },
      {
        date: '2025-11-08',
        title: "기획프로그램 '청운위의 랜덤팩토리' (청소년 44명 참여)",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6037',
      },
      {
        date: '2025-06-28',
        title: '2025 상반기 기관장 간담회',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5983',
      },
      {
        date: '2024-08-01',
        title: '청소년운영위원회 4개 기관 연합 교류활동',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5870',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=5',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6080',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6082',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6137',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6135',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6037',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5983',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5870',
    ],
  },
  {
    id: 'cl-player',
    name: '청소년참여위원회 PLAYER',
    field: '참여실현활동 · 청소년 정책참여',
    summary:
      '중구의 청소년 정책이 만들어지고 실행되는 과정에 청소년이 공식적으로 참여하는 제도적 기구로, 위원에게는 중구청장 명의 위촉장이 수여됩니다.',
    description:
      "중구의 청소년 정책이 만들어지고 실행되는 과정에 청소년이 공식적으로 참여하는 제도적 기구로, 위원에게는 중구청장 명의 위촉장이 수여됩니다. 정책 모니터링과 제안, 전년도에 제안한 정책의 실천(예: 헌 옷 플리마켓 '유스 빈티지 마켓'), 의견 수렴을 위한 간담회·대토론회 기획을 맡습니다.\n\n모집 안내(수집 시점): 2026 청소년 참여기구 통합 모집(서류 ~2026.3.13, 면접 3.14)으로 선발 완료.",
    meetingInfo: '2026.3 ~ 2027.2, 월 2회 토요일 14:00~16:00 (문의 02-2250-0525)',
    target: '중구 거주 또는 중구 소재 학교 재학 16~24세 청소년',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/bbsData/1749100547_LIST.jpg',
        caption: "2025 청소년 대토론회 '비정상회담 3.0' 포스터",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5963',
        date: '2025-06-05',
      },
    ],
    activities: [
      {
        date: '2026-04-18',
        title: "제5회 중구 청소년 대토론회 '중구 그림, 참여 팔레트'",
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6111',
      },
      {
        date: '2026-09',
        title: "청소년 정책실천활동 '유스(YOUTH) 빈티지 마켓' (2026.9월 중 예정으로 게시)",
        url: 'https://www.j-youth.org/kor/youth/board.php?part_idx=6',
      },
      {
        date: '2025-11-25',
        title: '영상: 2025 중구 청소년 참여 실현 활동 이야기',
        url: 'https://www.youtube.com/watch?v=ugTR8SPI5sc',
      },
      {
        date: '2025-05-31',
        title: "2025 청소년 대토론회 '비정상회담 3.0'",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5963',
      },
      {
        date: '2025-08-29',
        title: '2025 유스(YOUTH) 빈티지 마켓 모집 공지',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6016',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=6',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6080',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5931',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=5963',
      'https://www.youtube.com/watch?v=ugTR8SPI5sc',
    ],
  },
  {
    id: 'cl-child-committee',
    name: '아동참여위원회',
    field: '참여실현활동 · 아동 정책참여',
    summary: '초등 고학년이 자기 동네를 아동의 시선으로 살펴보고 필요한 정책을 찾아 제안하는 참여기구입니다.',
    description:
      '초등 고학년이 자기 동네를 아동의 시선으로 살펴보고 필요한 정책을 찾아 제안하는 참여기구입니다. 중구 아동 정책 모니터링과 제안, 전년도 제안 정책의 실천, 아지트 축제·청소년 축제 부스와 이벤트 기획을 통해 아동의 참여 권리를 직접 경험합니다.\n\n모집 안내(수집 시점): 2026 청소년 참여기구 통합 모집(서류 ~2026.3.13, 면접 3.14)으로 선발 완료. 2025년 모집 정원은 15명이었음.',
    meetingInfo: '2026.3 ~ 2027.2, 격주 토요일 10:00~12:00 (문의 02-2250-0523)',
    target: '중구 거주 또는 중구 소재 학교 재학 초등 4~6학년 연령',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/se2/photo_uploader/upload/1739252814.jpg',
        caption: '2025 아동참여위원회 신규위원 모집 포스터',
        sourceUrl: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5912',
        date: '2025-02-11',
      },
    ],
    activities: [
      {
        date: '2025-02-11',
        title: '2025 아동참여위원회 신규위원 모집 (정원 15명)',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5912',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=6',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6080',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5912',
    ],
  },
  {
    id: 'cl-youth-director',
    name: '청소년 관장제 (제3대 청소년관장)',
    field: '자치활동',
    summary: "청소년이 선거로 '청소년관장'을 뽑아 센터 운영과 평가에 참여하게 하는 제도입니다.",
    description:
      "청소년이 선거로 '청소년관장'을 뽑아 센터 운영과 평가에 참여하게 하는 제도입니다. 청소년관장은 관장실과 공약 사업 예산 결정권을 받아 공약을 실천하며, 2026년에는 중구·성동 청소년 명랑운동회, 어르신과 붕어빵을 나누는 세대공감 요리활동 등을 운영했습니다.\n\n모집 안내(수집 시점): 2026 제3대 청소년관장 후보자·선거인단 모집(2026.3.13 공고) 후 3.31 투표 결과 발표. 차기 신청 방법은 '추후 공지 예정'으로 게시.",
    meetingInfo: '임기 2026.3 ~ 2027.2 (문의 02-2250-0520)',
    target:
      '중구 거주 또는 중구 소재 학교 재학 16~24세, 센터 자치활동 경험자 또는 최근 3년 내 센터 프로그램 3회 이상 참여자',
    recruiting: false,
    status: 'active',
    photos: [],
    activities: [
      {
        date: '2026-08-29',
        title: "공약사업 세대공감 요리활동 '여름엔 붕어빵' (청소년 8명 모집)",
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6155',
      },
      {
        date: '2026-07-25',
        title: "공약활동 '중구 vs 성동 명랑운동회' (3층 체육관, 60명 모집)",
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6148',
      },
      {
        date: '2026-03-31',
        title: '2026 제3대 청소년관장 투표 결과',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6105',
      },
      {
        date: '2026-02-26',
        title: '2026 청소년 관장제 운영기관 간담회 (5개 기관)',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6092',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=5',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6097',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6105',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6148',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6155',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6092',
    ],
  },
  {
    id: 'cl-club-union',
    name: '동아리 연합회',
    field: '자치활동 · 동아리 연합',
    summary:
      '센터 소속 자치기구·참여기구·진로동아리 9곳의 대표 청소년이 모여 동아리끼리 교류하는 연합 모임입니다.',
    description:
      "센터 소속 자치기구·참여기구·진로동아리 9곳의 대표 청소년이 모여 동아리끼리 교류하는 연합 모임입니다. 2025년에는 대표 14명이 원오브유스 축제 부스, 연합 미니 이벤트를 운영했고, 12월에는 82명이 참여한 '동아리 연합평가회'를 직접 기획했습니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.",
    meetingInfo: '2026.6 ~ 12월 (문의 02-2250-0524)',
    target: '중구청소년센터 소속 자치기구·참여기구·진로동아리 9개의 대표 청소년',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/bbsData/1770454219_LIST.jpg',
        caption: '2025 동아리 연합평가회 포스터',
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6077',
        date: '2026-02-07',
      },
      {
        url: 'https://www.j-youth.org/data/bbsData/1758765876_LIST.jpg',
        caption: "One of Youth × 25 동아리 연합회 '나다움 플레이그라운드' 포스터",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6024',
        date: '2025-09-25',
      },
      {
        url: 'https://i.ytimg.com/vi/kbylCG6EYvk/hqdefault.jpg',
        caption: '2026 동아리 연합캠프 영상 썸네일',
        sourceUrl: 'https://www.youtube.com/watch?v=kbylCG6EYvk',
        date: '2026-05-20',
      },
    ],
    activities: [
      {
        date: '2026-05-20',
        title: "영상: 2026 동아리 연합캠프 '우리에겐 센터가 AGIT다'",
        url: 'https://www.youtube.com/watch?v=kbylCG6EYvk',
      },
      {
        date: '2025-12-13',
        title: "2025 동아리 연합평가회 '미리 새해 접속 중' (동아리 청소년 82명)",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6077',
      },
      {
        date: '2025-09-25',
        title: '2025 동아리 연합회 상반기 모음 (OT, 축제 부스·팝업 110명+ 참여)',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6024',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=5',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6024',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6077',
      'https://www.youtube.com/watch?v=kbylCG6EYvk',
    ],
  },
  {
    id: 'cl-humanities-musical',
    name: '인문학 뮤지컬단 (인문학 뮤지컬 오픈런 프로젝트)',
    field: '가치탐색활동 · 문화예술(뮤지컬)',
    summary:
      '청소년이 연출단과 배우단으로 나뉘어 주제 선정부터 대본, 연습, 공연까지 직접 만드는 창작 뮤지컬 프로젝트입니다.',
    description:
      '청소년이 연출단과 배우단으로 나뉘어 주제 선정부터 대본, 연습, 공연까지 직접 만드는 창작 뮤지컬 프로젝트입니다. 2026년에는 국가보훈부 보훈 테마활동 공모사업에 선정되어 중구 보훈 어르신들을 만나 들은 1950년의 이야기를 시공간 판타지 뮤지컬 「우리는 서로의 미래였다」로 무대에 올렸고, 뮤직비디오와 대본집도 공개했습니다.\n\n모집 안내(수집 시점): 2026 연출단·배우단 모집(2026.4.2 공고, 신청서 제출 후 오디션). 현재 진행 중인 것은 공연 관련 온라인 퀴즈 이벤트(2026.10.16 게시).',
    meetingInfo: '정기 모임 일정이 공개되지 않았습니다. 센터에 문의해 주세요.',
    target:
      '중구 거주 또는 중구 소재 학교 재학 초등 연령 청소년 (2026 사업 안내 기준; 2025 공연은 초등~중등 연령 참여)',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://i.ytimg.com/vi/Wv5bAsT_sYY/hqdefault.jpg',
        caption: '뮤지컬 「우리는 서로의 미래였다」 M/V 썸네일',
        sourceUrl: 'https://www.youtube.com/watch?v=Wv5bAsT_sYY',
        date: '2026-10-15',
      },
      {
        url: 'https://www.j-youth.org/data/bbsData/1781057162_LIST.jpg',
        caption: "2026 인문학 보훈 뮤지컬 '중구, 1950에서 온 메일' 포스터",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6139',
        date: '2026-06-10',
      },
    ],
    activities: [
      {
        date: '2026-10-16',
        title: '[대본집] 우리는 서로의 미래였다 공개 + 온라인 이벤트',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6171',
      },
      {
        date: '2026-10-15',
        title: '[M/V] 바람이 불어오는 곳 - 인문학 뮤지컬단',
        url: 'https://www.youtube.com/watch?v=Wv5bAsT_sYY',
      },
      {
        date: '2026-08-29',
        title: '보훈 프로젝트 공연 「중구, 1950에서 온 편지 : 우리는 서로의 미래였다」 (무료 공연)',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6159',
      },
      {
        date: '2026-06-10',
        title: "보훈 프로젝트 '중구, 1950에서 온 메일 #1' 활동 소식",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6139',
      },
      {
        date: '2025-08-23',
        title: "2025 오픈런 프로젝트 '우리 세계에는 괴물이 산다' 최종 공연",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6023',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=17',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6106',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6159',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6170',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6171',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6172',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6139',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6023',
    ],
  },
  {
    id: 'cl-frame',
    name: '미디어동아리 FRAME',
    field: '미래활동 · 미디어',
    summary:
      '영상과 사진에 관심 있는 청소년이 모여 촬영·편집 같은 기초부터 전문 교육까지 받고, 직접 기획한 미디어 콘텐츠를 만드는 동아리입니다.',
    description:
      '영상과 사진에 관심 있는 청소년이 모여 촬영·편집 같은 기초부터 전문 교육까지 받고, 직접 기획한 미디어 콘텐츠를 만드는 동아리입니다. 지역사회 연계 프로젝트와 축제에 참여하고 영상 공모전에 작품을 내는 활동도 합니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.',
    meetingInfo: '2026.3 ~ 2027.2, 토요일 13:00~15:00 (문의 02-2250-0533, 미래인재지원팀)',
    target: '14~24세 중구 청소년',
    recruiting: false,
    status: 'active',
    photos: [],
    activities: [
      {
        date: '2025-02-07',
        title: '2025 청소년 자치기구 및 진로동아리 모집 (자치기구로 FRAME 포함)',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=12',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
    ],
  },
  {
    id: 'cl-startup-quirky-day',
    name: '창업동아리 (브랜드 QUIRKY DAY)',
    field: '창업활동',
    summary:
      "청소년이 자체 브랜드 'QUIRKY DAY'를 운영하며 아이템 기획, 제작, 홍보, 판매까지 창업의 전 과정을 모의로 경험하는 동아리입니다.",
    description:
      "청소년이 자체 브랜드 'QUIRKY DAY'를 운영하며 아이템 기획, 제작, 홍보, 판매까지 창업의 전 과정을 모의로 경험하는 동아리입니다. 센터는 이 브랜드를 청소년의 독창적 아이디어로 만든 제품으로 일상에 특별함을 더하는 브랜드라고 소개하며, 활동 기록은 인스타그램 @QUIRKY_DAY에 올린다고 안내합니다. 2025년 모집 공고에서는 '창업동아리 윔지컬'이라는 이름으로 모집했습니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.",
    meetingInfo: '2026.3 ~ 12월, 매주 토요일 13:00~15:00 (문의 02-2250-0534, 미래인재지원팀)',
    target: '창업에 관심 있는 고등 연령 청소년 및 후기 청소년 (중구민·관내 재학생 우대)',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/designImages/M1757394187.jpg',
        caption: "창업브랜드 소개 페이지의 'RAMI Lab.' 제품 홍보 이미지",
        sourceUrl: 'https://www.j-youth.org/kor/youth/startup01.php',
        date: null,
      },
    ],
    activities: [
      {
        date: '2025-02-07',
        title: "2025 자치기구 모집 공고에 '창업동아리 윔지컬'로 게시",
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=34',
      'https://www.j-youth.org/kor/youth/startup01.php',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
    ],
  },
  {
    id: 'cl-asta',
    name: '바리스타동아리 아스타 (ASTA)',
    field: '진로동아리 · 바리스타/식음료 창업',
    summary: "중구진로직업체험지원센터 '드림톡톡'의 진로동아리로, 2026년 13기를 맞은 장수 동아리입니다.",
    description:
      "중구진로직업체험지원센터 '드림톡톡'의 진로동아리로, 2026년 13기를 맞은 장수 동아리입니다. 매주 토요일 바리스타 멘토링과 음료 실습, 레시피 개발을 하고, 유명 카페 탐방으로 상권과 메뉴를 분석하거나 지역 행사 판매·창업 활동에 참여합니다. 2026년에는 서울시 청소년 그룹활동 지원사업에 선정되었고, 센터 로비 벽을 플랜테리어로 직접 꾸미기도 했습니다.\n\n모집 안내(수집 시점): 2026 13기 모집: 2026.2.3 ~ 3.13, 면접 3.14(토) 11시.",
    meetingInfo:
      '매주 토요일 10:00~12:30 (시험기간·공휴일 제외), 신당누리센터 4층 진로직업체험지원센터 (청구역 1번 출구), 참가비 무료, 문의 02-2250-0582',
    target: '고등학교 1학년(17세) 이상 연령 청소년',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://mblogthumb-phinf.pstatic.net/MjAyNjA2MThfMjcg/MDAxNzgxNzY5MTY5NjY2.K1gYM8OCLpeRPmRM1xXCSzjk8SYk7JR31bTKw58atg4g.is9h6Q5btHtiJnSKxXrY460KCdlSyumgAU35grIKONkg.JPEG/fd262707-8930-4bf9-b1c0-a89417a83a67.jpg?type=w773',
        caption: '아스타가 완성한 드림톡톡 로비 플랜테리어 벽면',
        sourceUrl: 'https://blog.naver.com/j_youth/224319993572',
        date: '2026-06-18',
      },
      {
        url: 'https://mblogthumb-phinf.pstatic.net/MjAyNjA2MThfMjM0/MDAxNzgxNzY4Mzk0NzQz.coT8yiDWwSc8XCQOOzII-L_Dz29pa4me1MSzYyj4i5cg.U4qWXt_VI-soOhB6_tibaUJ1HrOeHpmvRsYGhut5Jqog.JPEG/%EC%A0%9C%EB%AA%A9%EC%9D%84_%EC%9E%85%EB%A0%A5%ED%95%B4%EC%A3%BC%EC%84%B8%EC%9A%94._(20).jpg?type=w773',
        caption: "'바리스타동아리 ASTA 진로센터 플랜테리어 후기' 타이틀 이미지",
        sourceUrl: 'https://blog.naver.com/j_youth/224319993572',
        date: '2026-06-18',
      },
    ],
    activities: [
      {
        date: '2026-06-18',
        title: "드림톡톡 로비 '플랜테리어' 벽면 꾸미기",
        url: 'https://blog.naver.com/j_youth/224319993572',
      },
      {
        date: '2026-05-06',
        title: '센터 옥상 바베큐 파티 (동아리원 13명)',
        url: 'https://blog.naver.com/j_youth/224276710173',
      },
      {
        date: '2026-04-18',
        title: '2026 서울시 청소년 그룹활동 지원사업 선정 (아스타·메이킹)',
        url: 'https://blog.naver.com/j_youth/224256540005',
      },
      {
        date: '2025-06-21',
        title: '조별 서울 이색 카페 탐방 및 창업 분석',
        url: 'https://blog.naver.com/j_youth/223906701236',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/center/board.php?part_idx=22',
      'https://blog.naver.com/j_youth/224165440288',
      'https://blog.naver.com/j_youth/224319993572',
      'https://blog.naver.com/j_youth/224276710173',
      'https://blog.naver.com/j_youth/224256540005',
      'https://blog.naver.com/j_youth/223906701236',
    ],
  },
  {
    id: 'cl-making',
    name: '메이커동아리 MAKING (메이킹)',
    field: '진로동아리 · 메이커/4차산업 기술',
    summary:
      '드림톡톡 메이킹랩에서 3D프린터 등 메이커 장비와 신기술을 배우고, 일상의 불편을 해결하는 발명 프로젝트를 스스로 진행하는 초등 고학년~중1 대상 동아리로 2026년 6기째입니다.',
    description:
      "드림톡톡 메이킹랩에서 3D프린터 등 메이커 장비와 신기술을 배우고, 일상의 불편을 해결하는 발명 프로젝트를 스스로 진행하는 초등 고학년~중1 대상 동아리로 2026년 6기째입니다. 메이커 스페이스 탐방과 지역 연계 활동도 하며, 2026 AGIT 축제에서는 직접 3D 프린팅한 마패를 상품으로 건 틀린그림찾기 부스 '암행어사 출두요!'를 운영했습니다.\n\n모집 안내(수집 시점): 6기 추가모집 2명 공고(2026.9.17 블로그). 모집기간 '공고 시작일 ~ 마감 시 별도 공지'로 마감 여부 미확인. 신청: 블로그 링크/QR 또는 전화 02-2250-0581.",
    meetingInfo:
      '2026.3 ~ 12월 매주 토요일 10:00~12:00 (일부 토요일 제외), 신당누리센터 4층 진로센터 메이킹랩, 문의 02-2250-0581',
    target: '서울 거주 또는 서울 소재 학교 재학 초등 4학년 ~ 중학교 1학년 (정원 13명)',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://mblogthumb-phinf.pstatic.net/MjAyNjA3MjlfNTAg/MDAxNzg1Mjg2OTA4ODYw.YB58PRK-CjynzPCIIqlzqYpLdRjbFfLYRhmH416tWCwg.tsawpeRNxK6G14uJtMVVWym_NJ69F_upkOYfYeXj4L0g.JPEG/KakaoTalk_20260729_100015474.jpg?type=w773',
        caption: '동아리원이 3D 프린터로 만든 마패 소품',
        sourceUrl: 'https://blog.naver.com/j_youth/224297795392',
        date: '2026-05-27',
      },
      {
        url: 'https://mblogthumb-phinf.pstatic.net/MjAyNjA3MjlfMTk0/MDAxNzg1Mjg2NjI5OTk1.XcMAdvDjKtMTb0JpbpJERaMxA16dyS4LIsObZFjZHCQg.gzwP92mp5FoW_BcxpF5Z-wFzr7uHfVK9Vgnz813Yxasg.JPEG/KakaoTalk_20260728_105750047_09.jpg?type=w773',
        caption: "AGIT 축제 '암행어사 출두요!' 틀린그림찾기 부스에 몰린 참가자",
        sourceUrl: 'https://blog.naver.com/j_youth/224297795392',
        date: '2026-05-27',
      },
      {
        url: 'https://mblogthumb-phinf.pstatic.net/MjAyNjA5MTdfMjI3/MDAxNzg5NjI0MDU3ODAx.4ldcA4VvExSP5Jb1j7l5MImfby3-yIeWHaoO3FZwSo0g.uqpuNvLulnDkPUMKEj8hKFA8QqoIUAIJ64JEFBBvW8Mg.JPEG/%EC%A0%9C%EB%AA%A9%EC%9D%84_%EC%9E%85%EB%A0%A5%ED%95%B4%EC%A3%BC%EC%84%B8%EC%9A%941242.jpg?type=w773',
        caption: 'MAKING 6기 추가 동아리원 모집 포스터',
        sourceUrl: 'https://blog.naver.com/j_youth/224414938190',
        date: '2026-09-17',
      },
    ],
    activities: [
      {
        date: '2026-09-17',
        title: '6기 추가 동아리원 모집 (2명)',
        url: 'https://blog.naver.com/j_youth/224414938190',
      },
      {
        date: '2026-05-09',
        title: "AGIT 축제 '라미네 잔칫집' 부스 '암행어사 출두요!' 운영 (후기 2026-05-27)",
        url: 'https://blog.naver.com/j_youth/224297795392',
      },
      {
        date: '2026-04-18',
        title: '2026 서울시 청소년 그룹활동 지원사업 선정',
        url: 'https://blog.naver.com/j_youth/224256540005',
      },
      {
        date: '2026-01-30',
        title: '2026 6기 신규 동아리원 모집 (2.3~3.6, 면접 3.7)',
        url: 'https://blog.naver.com/j_youth/224165474369',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/center/board.php?part_idx=22',
      'https://blog.naver.com/j_youth/224165474369',
      'https://blog.naver.com/j_youth/224414938190',
      'https://blog.naver.com/j_youth/224297795392',
      'https://blog.naver.com/j_youth/224256540005',
    ],
  },
  {
    id: 'cl-junggu-trip',
    name: '마을탐방동아리 중구트립',
    field: '지역활동 · 마을탐방',
    summary:
      '초등 고학년이 중구 곳곳을 탐방하고 그 경험을 글·그림·사진, 인스타툰이나 동화책 같은 홍보물로 기록해 알리는 활동입니다.',
    description:
      '초등 고학년이 중구 곳곳을 탐방하고 그 경험을 글·그림·사진, 인스타툰이나 동화책 같은 홍보물로 기록해 알리는 활동입니다. 결과물은 전시·배포·온라인으로 공유되고, 2025년에는 자치기구로서 축제 부스와 연합활동에도 참여했습니다. 2026년 게시판에는 9~10월 중 운영되는 지역활동 프로그램으로 안내되어 있습니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.',
    meetingInfo:
      '2026: 9~10월 중 (상세 일정 미게시). 2025년 기준 토요일 10:00~12:00, 월 2~3회. 문의 02-2250-0534',
    target: '초등 4~6학년 연령 (중구민·관내 재학생 우대)',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/se2/photo_uploader/upload/1739838332.jpg',
        caption: '2025 중구트립 신규 동아리원 모집 포스터',
        sourceUrl: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5919',
        date: '2025-02-18',
      },
    ],
    activities: [
      {
        date: '2025-02-18',
        title: '2025 중구트립 동아리원 모집 (초4~6 10명)',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5919',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=10',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5919',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
    ],
  },
  {
    id: 'cl-agit-planners',
    name: 'AGIT(아지트) 기획단',
    field: '참여활동 · 청소년 공간 기획',
    summary: '2025년 모집 공고에서 참여활동 4개 중 하나로 모집된 기획단입니다.',
    description:
      '2025년 모집 공고에서 참여활동 4개 중 하나로 모집된 기획단입니다. 2024년에는 기획단이 기획한 방탈출 이벤트 참가자 모집 공지가 있었습니다. 2026년 운영 여부는 공개 채널에서 확인되지 않았습니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.',
    meetingInfo: '정기 모임 일정이 공개되지 않았습니다. 센터에 문의해 주세요.',
    target: null,
    recruiting: false,
    status: 'inactive',
    photos: [],
    activities: [
      {
        date: '2025-02-07',
        title: "2025 자치기구·진로동아리 모집 공고에 'AGIT(아지트) 기획단' 포함",
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
      },
      {
        date: '2024-09-25',
        title: '2024 아지트 기획단 기획 방탈출 이벤트 참가자 모집',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5849',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5910',
      'https://www.j-youth.org/kor/community/youth.php?pNo=9',
    ],
  },
  {
    id: 'cl-late-youth-humanities',
    name: '후기 청소년 인문학 활동단',
    field: '가치탐색활동 · 인문학',
    summary:
      '대학생 연령의 후기 청소년이 자기 삶과 경험을 인문학적으로 돌아보며 직접 강의안을 설계하고, 시연과 상호 피드백을 거쳐 중등 청소년에게 인문학 강의를 하는 활동입니다.',
    description:
      '대학생 연령의 후기 청소년이 자기 삶과 경험을 인문학적으로 돌아보며 직접 강의안을 설계하고, 시연과 상호 피드백을 거쳐 중등 청소년에게 인문학 강의를 하는 활동입니다. 2025년에는 5명이 6~9월 활동하고 결과를 히스토리북으로 펴냈습니다.\n\n모집 안내: 공개 채널에서 확인되지 않았습니다. 센터에 문의해 주세요.',
    meetingInfo: '2026.4 ~ 12월 중 (문의 02-2250-0525)',
    target: '대학생 연령 후기 청소년 (중구 거주·관내 재학 우선 선발)',
    recruiting: false,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/bbsData/1764216621_LIST.jpg',
        caption: "2025 후기 청소년 인문학 활동단 '사소하지만 확실한 인문학' 표지",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6044',
        date: '2025-11-27',
      },
      {
        url: 'https://www.j-youth.org/data/goodsImages/GOODS_1735964601_1735964240.jpg',
        caption: '극장에서 인문학 강의를 진행하는 후기 청소년',
        sourceUrl: 'https://www.j-youth.org/kor/youth/board.php?part_idx=17',
        date: null,
      },
    ],
    activities: [
      {
        date: '2025-11-27',
        title: '2025 후기 청소년 인문학 활동단 결과 및 히스토리북',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6044',
      },
      {
        date: '2025-05-10',
        title: '2025 후기 청소년 인문학 활동단 모집',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=5948',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/board.php?part_idx=17',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6044',
    ],
  },
  {
    id: 'cl-after-school-academy',
    name: "청소년방과후아카데미 '꿈을 여는 교실'",
    field: "방과후 돌봄 · 종합지원 (자치동아리 '우리끼리 프로젝트' 포함)",
    summary:
      '성평등가족부와 중구청이 지원하는 방과후 종합지원 프로그램으로, 학습 지원·체험·상담을 묶어 평일 저녁까지 운영합니다.',
    description:
      "성평등가족부와 중구청이 지원하는 방과후 종합지원 프로그램으로, 학습 지원·체험·상담을 묶어 평일 저녁까지 운영합니다. 바이올린과 중등 밴드 같은 1인 1악기 활동, 연극, 디지털 디자인 수업이 있고, 청소년이 직접 운영하는 자치동아리 '우리끼리 프로젝트'(초등 도.구.다.·네모네모 제작소, 중등 요리조리)도 있습니다. 주말체험(예: 2026년 9월 에버랜드)과 청소년자기도전포상제도 함께 운영합니다.\n\n모집 안내(수집 시점): 정원 내 상시 모집(전화상담 → 방문상담 → 입학 결정). 2026 신입생 모집 공고 2026.1.14.",
    meetingInfo:
      '월~금 16:00~20:00 (공휴일·주말 미운영, 방학 중 돌봄·점심 제공), 센터 1층 전용교실, 참가비 무료(교재 등 일부 자부담), 문의 02-2250-0535~0537',
    target: '방과후 돌봄이 필요한 초등 4학년 ~ 중등 3학년 (꿈여울반 초4~6 20명, 한마루반 중1~3 20명)',
    recruiting: true,
    status: 'active',
    photos: [
      {
        url: 'https://www.j-youth.org/data/bbsData/1789705280_LIST.png',
        caption: "9월 주말체험활동 '환상의나라 에버랜드' 손글씨 표지",
        sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6164',
        date: '2026-09-18',
      },
      {
        url: 'https://www.j-youth.org/kor/images/sub/academy_img02_260508.jpg',
        caption: '방과후아카데미 중점운영방향 다이어그램',
        sourceUrl: 'https://www.j-youth.org/kor/youth/academy.php',
        date: null,
      },
      {
        url: 'https://www.j-youth.org/se2/photo_uploader/upload/1769574669.jpg',
        caption: '2026 청소년방과후아카데미 신입생 모집 포스터',
        sourceUrl: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6063',
        date: '2026-01-14',
      },
    ],
    activities: [
      {
        date: '2026-09-18',
        title: "9월 주말체험활동 '환상의 나라 에버랜드'",
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6164',
      },
      {
        date: '2026-05-11',
        title: '이순신 WEEK 마인크래프트 거북선 포토존 조성 (4.16~4.18)',
        url: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6123',
      },
      {
        date: '2026-01-14',
        title: '2026 꿈을여는교실 신입생 모집',
        url: 'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6063',
      },
    ],
    sourceUrls: [
      'https://www.j-youth.org/kor/youth/academy.php',
      'https://www.j-youth.org/kor/community/youth.php?m=v&idx=6063',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6164',
      'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6123',
    ],
  },
];

export const RESEARCH_MEDIA: MediaItem[] = [
  {
    kind: 'photo',
    title: '중구청소년센터 건물 전경',
    url: 'https://www.j-youth.org/kor/images/sub/info_00_01.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/info_00_01.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '3층 체육관',
    url: 'https://www.j-youth.org/kor/images/sub/info_f3_01.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/info_f3_01.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '3층 거울·피아노가 있는 다목적 공간',
    url: 'https://www.j-youth.org/kor/images/sub/info_f3_02.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/info_f3_02.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '3층 휴식형 공간',
    url: 'https://www.j-youth.org/kor/images/sub/info_f3_03.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/info_f3_03.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '청소년 활동공간의 AR 디지털 체육 플랫폼 DIDIM(디딤)',
    url: 'https://www.j-youth.org/kor/images/sub/facilities02_01.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/facilities02_01.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities02.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '누구나 이용 가능한 청소년 활동공간의 계단형 소파',
    url: 'https://www.j-youth.org/kor/images/sub/facilities02_02.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/facilities02_02.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities02.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '지하1층 카페 라라 내부',
    url: 'https://www.j-youth.org/kor/images/sub/facilities03_02.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/facilities03_02.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities03.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '카페 라라 로고 배너',
    url: 'https://www.j-youth.org/kor/images/sub/facilities03_01.jpg',
    thumbnailUrl: 'https://www.j-youth.org/kor/images/sub/facilities03_01.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/about/facilities03.php',
    date: null,
  },
  {
    kind: 'photo',
    title: '중구청소년센터 개관 25주년 기념식 카드',
    url: 'https://www.j-youth.org/data/bbsData/1789980291_LIST.jpg',
    thumbnailUrl: 'https://www.j-youth.org/data/bbsData/1789980291_LIST.jpg',
    sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6166',
    date: '2026-09-21',
  },
  {
    kind: 'photo',
    title: "2026 POP-UP AGIT(1월) '라미의 집들이' 표지",
    url: 'https://www.j-youth.org/data/bbsData/1769584341_LIST.png',
    thumbnailUrl: 'https://www.j-youth.org/data/bbsData/1769584341_LIST.png',
    sourceUrl: 'https://www.j-youth.org/kor/community/gallery.php?m=v&idx=6073',
    date: '2026-01-28',
  },
  {
    kind: 'video',
    title: '[M/V] 바람이 불어오는 곳 - 인문학 뮤지컬단',
    url: 'https://www.youtube.com/watch?v=Wv5bAsT_sYY',
    thumbnailUrl: 'https://i.ytimg.com/vi/Wv5bAsT_sYY/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=Wv5bAsT_sYY',
    date: '2026-10-15',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 2026 중구청소년센터 25주년 기념 행사 스케치 영상',
    url: 'https://www.youtube.com/watch?v=I5PBT7alWKo',
    thumbnailUrl: 'https://i.ytimg.com/vi/I5PBT7alWKo/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=I5PBT7alWKo',
    date: '2026-09-22',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 중구청소년센터의 새로운 브랜딩 소개',
    url: 'https://www.youtube.com/watch?v=6WDCf_NqpdE',
    thumbnailUrl: 'https://i.ytimg.com/vi/6WDCf_NqpdE/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=6WDCf_NqpdE',
    date: '2026-09-21',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 개관 25주년 영상',
    url: 'https://www.youtube.com/watch?v=0Ina0Xnnh6A',
    thumbnailUrl: 'https://i.ytimg.com/vi/0Ina0Xnnh6A/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=0Ina0Xnnh6A',
    date: '2026-09-21',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] - 2026 ONE OF YOUTH Sketch Video 3',
    url: 'https://www.youtube.com/watch?v=gMzzwGqbA_8',
    thumbnailUrl: 'https://i.ytimg.com/vi/gMzzwGqbA_8/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=gMzzwGqbA_8',
    date: '2026-06-17',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] - 2026 ONE OF YOUTH Sketch Video 2',
    url: 'https://www.youtube.com/watch?v=0ALde0tWP0Y',
    thumbnailUrl: 'https://i.ytimg.com/vi/0ALde0tWP0Y/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=0ALde0tWP0Y',
    date: '2026-06-17',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] - 2026 ONE OF YOUTH Sketch Video 1',
    url: 'https://www.youtube.com/watch?v=Oy7OP8j_e6M',
    thumbnailUrl: 'https://i.ytimg.com/vi/Oy7OP8j_e6M/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=Oy7OP8j_e6M',
    date: '2026-06-17',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 2026 AGIT 축제 "라미네 잔칫집"',
    url: 'https://www.youtube.com/watch?v=_gHktBanndQ',
    thumbnailUrl: 'https://i.ytimg.com/vi/_gHktBanndQ/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=_gHktBanndQ',
    date: '2026-05-20',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 2026 AGIT 축제 "라미네 잔칫집"',
    url: 'https://www.youtube.com/watch?v=WZjkNggT-sQ',
    thumbnailUrl: 'https://i.ytimg.com/vi/WZjkNggT-sQ/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=WZjkNggT-sQ',
    date: '2026-05-20',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 2026 동아리 연합캠프 "우리에겐 센터가 AGIT다"',
    url: 'https://www.youtube.com/watch?v=kbylCG6EYvk',
    thumbnailUrl: 'https://i.ytimg.com/vi/kbylCG6EYvk/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=kbylCG6EYvk',
    date: '2026-05-20',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 중구청소년센터 이름 절망 편',
    url: 'https://www.youtube.com/watch?v=sZfqAO3CFG4',
    thumbnailUrl: 'https://i.ytimg.com/vi/sZfqAO3CFG4/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=sZfqAO3CFG4',
    date: '2026-03-26',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 2025 중구 청소년 참여 실현 활동 이야기',
    url: 'https://www.youtube.com/watch?v=ugTR8SPI5sc',
    thumbnailUrl: 'https://i.ytimg.com/vi/ugTR8SPI5sc/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=ugTR8SPI5sc',
    date: '2025-11-25',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 중구청소년센터 홍보 영상',
    url: 'https://www.youtube.com/watch?v=XFs71iyvkv0',
    thumbnailUrl: 'https://i.ytimg.com/vi/XFs71iyvkv0/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=XFs71iyvkv0',
    date: '2025-10-30',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 왁킹(수현)',
    url: 'https://www.youtube.com/watch?v=Q6d_Ua3TW8Q',
    thumbnailUrl: 'https://i.ytimg.com/vi/Q6d_Ua3TW8Q/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=Q6d_Ua3TW8Q',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 힙합(코이)',
    url: 'https://www.youtube.com/watch?v=bWw9JlgWfHI',
    thumbnailUrl: 'https://i.ytimg.com/vi/bWw9JlgWfHI/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=bWw9JlgWfHI',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH - 퍼스널트릭유닛',
    url: 'https://www.youtube.com/watch?v=bPKN1bg3Yog',
    thumbnailUrl: 'https://i.ytimg.com/vi/bPKN1bg3Yog/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=bPKN1bg3Yog',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 하우스(보라)',
    url: 'https://www.youtube.com/watch?v=HEfvNrnq8Qg',
    thumbnailUrl: 'https://i.ytimg.com/vi/HEfvNrnq8Qg/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=HEfvNrnq8Qg',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 엠브리오',
    url: 'https://www.youtube.com/watch?v=21Q4JqWJh8Y',
    thumbnailUrl: 'https://i.ytimg.com/vi/21Q4JqWJh8Y/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=21Q4JqWJh8Y',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH - 다원',
    url: 'https://www.youtube.com/watch?v=R4q_wk-rClY',
    thumbnailUrl: 'https://i.ytimg.com/vi/R4q_wk-rClY/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=R4q_wk-rClY',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 더본',
    url: 'https://www.youtube.com/watch?v=YppMUDYDcEA',
    thumbnailUrl: 'https://i.ytimg.com/vi/YppMUDYDcEA/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=YppMUDYDcEA',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 힙합(펄디)',
    url: 'https://www.youtube.com/watch?v=1C8kfEy-G7o',
    thumbnailUrl: 'https://i.ytimg.com/vi/1C8kfEy-G7o/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=1C8kfEy-G7o',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH – 베이스드',
    url: 'https://www.youtube.com/watch?v=PgJvW3GeDvM',
    thumbnailUrl: 'https://i.ytimg.com/vi/PgJvW3GeDvM/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=PgJvW3GeDvM',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] ONE OF YOUTH - 브레이킹(하늘)',
    url: 'https://www.youtube.com/watch?v=1J6f0DyZ2a4',
    thumbnailUrl: 'https://i.ytimg.com/vi/1J6f0DyZ2a4/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=1J6f0DyZ2a4',
    date: '2025-09-19',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 25 ONE OF YOUTH 스케치 영상',
    url: 'https://www.youtube.com/watch?v=5LjOirRxT8M',
    thumbnailUrl: 'https://i.ytimg.com/vi/5LjOirRxT8M/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=5LjOirRxT8M',
    date: '2025-09-11',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 미래기술교육-AI, 노래를 만들어줘(장충고-4조 교가)',
    url: 'https://www.youtube.com/watch?v=Hx__31kcwio',
    thumbnailUrl: 'https://i.ytimg.com/vi/Hx__31kcwio/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=Hx__31kcwio',
    date: '2025-08-27',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 미래기술교육-AI, 노래를 만들어줘(장충고-1조 교가)',
    url: 'https://www.youtube.com/watch?v=IfittPM41iI',
    thumbnailUrl: 'https://i.ytimg.com/vi/IfittPM41iI/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=IfittPM41iI',
    date: '2025-08-27',
  },
  {
    kind: 'video',
    title: '[중구청소년센터] 미래기술교육-AI, 노래를 만들어줘(장원중-3조 반가)',
    url: 'https://www.youtube.com/watch?v=Mdkb97_5DT0',
    thumbnailUrl: 'https://i.ytimg.com/vi/Mdkb97_5DT0/hqdefault.jpg',
    sourceUrl: 'https://www.youtube.com/watch?v=Mdkb97_5DT0',
    date: '2025-06-19',
  },
];

export const RESEARCH_NOTICES: Pick<Notice, 'title' | 'category' | 'body'>[] = [
  {
    title: '[참고] 토요일 오후 청소년 전용시간제 운영',
    category: 'youth',
    body: '매주 토요일 14:00~18:30, 센터 1~3층을 9~24세 청소년만 이용(성인 보호자 출입 제한). 청소년운영위원회 제안으로 도입.\n\n출처: https://www.j-youth.org/kor/community/youth.php?m=v&idx=6082\n수집일: 2026-10-17 — 센터 공식 채널에서 수집한 참고 정보입니다. 변경되었을 수 있으니 센터에 확인해 주세요.',
  },
  {
    title: "[참고] 2026 중구 청소년 축제 '야호' (10.31)",
    category: 'youth',
    body: '2026.10.31(토) 덕수궁 돌담길. 청소년 주도 체험 부스, 동아리 경연대회(보컬·댄스 등, 10~11월 중) 연계. 문의 02-2250-0523.\n\n출처: https://www.j-youth.org/kor/youth/board.php?part_idx=5\n수집일: 2026-10-17 — 센터 공식 채널에서 수집한 참고 정보입니다. 변경되었을 수 있으니 센터에 확인해 주세요.',
  },
  {
    title: '[참고] 지하 1층 카페 라라 운영 안내',
    category: 'center',
    body: 'B1, 화~토 08:30~19:30(일·월·법정공휴일 휴무). 청소년(초1~만24세) 10% 할인·포인트 적립, 그 외 10% 적립. 문의 02-2250-0570.\n\n출처: https://www.j-youth.org/kor/about/facilities03.php\n수집일: 2026-10-17 — 센터 공식 채널에서 수집한 참고 정보입니다. 변경되었을 수 있으니 센터에 확인해 주세요.',
  },
];
