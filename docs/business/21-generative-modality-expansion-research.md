# Generated Image / Audio Modality Expansion Research (생성 이미지·오디오 모달리티 확장 검토)

Status: Focused strategy research draft
Last updated: 2026-06-10
Owner: Business + Product + Engineering
Language note: Written in Korean for founder strategy review, following doc 20's convention.
Related: `20-zeta-engagement-strategy-research.md` (서사 몰입 전략 — 본 문서의 이미지/오디오 유스케이스 다수가 그 전략의 실행 수단이다)

## Purpose (목적)

이 메모는 다음 전략 가설을 기술 구현 가능성과 효용 양면에서 검증한다:

> Ideogram이나 오픈소스 이미지/오디오 생성 모델을 이용해 Lingual의 모달리티를 배로 늘린다 (현재: 음성 대화 + 텍스트 → 추가: 생성 이미지 + 생성 오디오).

## Executive Verdict (결론 요약)

**기술적으로는 즉시 구현 가능하고 비용도 사실상 무시 가능한 수준이다. 그러나 "모달리티를 배로"라는 전면 확장 프레임은 틀렸고, 북극성 지표(학생 발화 시간)에 복무하는 좁은 쐐기 4개로 추진해야 한다.**

| 유스케이스 | 효용 | 구현 난이도 | 한계비용 | 판정 |
| --- | --- | --- | --- | --- |
| ① 과제 저작 시점 장면 일러스트 (서사 에피소드 커버·장면) | 높음 | 낮음 (1–2주) | **~$0.01–0.04/과제** (학생 수와 무관) | **즉시 추진** |
| ② 그림 묘사·서사 과제 타입 (picture description/narration) | 높음 (ACTFL 기능 직결) | 중간 (1–2주) | 저작 시점과 동일 | **추진** |
| ③ 저비용 TTS 내레이션/듣기 레이어 (텍스트 모드 보강) | 높음 (자발 연습 비용 문제 해결) | 낮음 (휴면 파이프라인 재사용) | **~$0.001/분 이하** (오픈 TTS) | **추진** |
| ④ 앰비언트 사운드 라이브러리 (장면 배경음) | 중간 (몰입 가산) | 낮음 | 1회 라이브러리 비용, 회당 ~$0.03 | 여력 시 추진 |
| ⑤ 학생 트리거 실시간 이미지 생성 | 낮음 | 중간 | 통제 불가 | **보류 (안전·비용)** |
| ⑥ 음성 클로닝·캐릭터 커스텀 보이스 | 낮음 | 중간 | — | **보류 (동의·리스크)** |

핵심 판단 근거 세 가지:

1. **비용 구조가 한쪽으로 기울어 있다.** 이미지 생성은 호스티드 API 기준 장당 $0.003–0.03이고, **저작 시점에 생성하면 학생 수·세션 수와 무관한 고정비**가 된다. 좌석당 마진에 영향 없음.
2. **안전 아키텍처가 유스케이스를 결정한다.** 2025-12 LAUSD 초등학교에서 Adobe의 *교육용* 제품이 4학년 과제에 선정적 AI 이미지를 노출한 사건 이후, 미성년자 대상 생성 이미지는 "교사 검토를 거친 사전 생성"만이 조달 심사에서 방어 가능하다. 이는 우연히도 가장 싼 아키텍처와 일치한다.
3. **모달리티는 목표가 아니라 수단이다.** 이미지·오디오가 학생의 **발화를 끌어내는 입력**(그림 묘사 과제, 장면 몰입)으로 쓰이면 북극성을 견인하고, 학생이 **소비하는 출력**(구경하는 콘텐츠)으로 쓰이면 발화 시간을 잠식한다. 모든 기능 설계에 이 구분을 적용한다.

---

# Part 0. 용어 정정 (전략 입력으로서의 사실 확인)

전략 가설에 등장한 두 이름은 모두 실재하지만, 둘 다 가설이 전제한 것과 다르다:

- **Ideogram은 오픈소스가 아니다.** 상용 API다 (Ideogram 3.0, 장당 약 $0.03–0.09 — 공식 단가 페이지 접근 불가로 2차 출처 기준, 인용 전 재확인 필요). 2026-06-03에 9.3B 모델 "Ideogram 4"의 가중치를 공개했지만 **라이선스가 비상업(Non-Commercial)이라 SaaS에 사용할 수 없다.** Ideogram의 진짜 강점은 이미지 안 텍스트 렌더링(간판, 메뉴판, 표지판)이며, 이게 필요한 경우에만 API로 쓰는 게 맞다.
- **misoAI = Miso Labs의 MisoTTS.** 2026-06-03(1주 전) 공개된 8B 오픈웨이트 TTS 모델이다. 이미지 모델이 아니고, **현재 영어 전용**이라 Lingual의 학습 로케일(es-ES, fr-FR, ko-KR 등)에 쓸 수 없으며, 24GB VRAM급 GPU가 필요해 "저비용 오픈소스"로서의 매력도 현시점엔 없다. 다만 "오픈 TTS의 품질 상한이 빠르게 오르고 있다"는 신호로서는 유효하다.

이 정정이 주는 교훈: **이 영역은 모델 이름이 아니라 (a) 라이선스, (b) 로케일 커버리지, (c) 호스티드 단가 세 변수로 골라야 한다.** 아래 Part 2가 그 기준으로 정리한 표다.

# Part 1. 현재 스택 진단 (구현 가능성의 출발점)

코드베이스 확인 결과:

| 영역 | 현황 | 함의 |
| --- | --- | --- |
| 음성 대화 | `gpt-realtime-mini-2025-12-15` 실시간 세션 (`backend/routes/chat.py`) | 대화 품질의 핵심. 분당 단가가 높은 모달리티 (~$0.10–0.30/분 혼합 추정) |
| 비용 통제 | `voice_minutes_cap` 정책 + 세션별 `cost_summary` 추적 이미 존재 | 신규 모달리티 비용도 같은 구조로 계량 가능 — 인프라 추가 불요 |
| TTS/STT 파이프라인 | 휴면 아바타 모듈에 whisper-1 + `gpt-4o-mini-tts` 코드 존재 (`backend/avatar_chat.py`), `OPENAI_TTS_MODEL` env로 모델 교체 가능 | ③번 유스케이스는 신규 개발이 아니라 **재활성화 + 프로바이더 추상화** 수준 |
| 이미지 생성 | 전무 | ①②는 신규지만 접합점이 명확: 과제 저작의 `generated_scenario` 생성 플로우 |
| 인프라 | Cloud Run + gunicorn, GPU 없음 | 오픈 모델 자체 호스팅은 신규 인프라 투자 — Part 2.3에서 기각 |
| 프론트 | 과제 빌더(TeacherAssignmentBuilderPage), 연습 워크스페이스, 미니게임 | 이미지 표시·승인 UI 추가는 통상적 작업 |

결론: **기술 부채 없이 얹을 수 있는 위치에 있다.** 특히 비용 계량과 정책 캡 구조가 이미 있다는 점, TTS 파이프라인이 코드로 존재한다는 점이 구현 리스크를 크게 낮춘다.

# Part 2. 기술 구현 가능성: 모델·단가·라이선스 (2026-06 기준)

## 2.1 이미지 생성 — 선택지와 함정

| 모델 | 라이선스/형태 | 상업 SaaS 사용 | 단가 (호스티드) | 비고 |
| --- | --- | --- | --- | --- |
| **FLUX.1 [schnell]** | Apache 2.0 (오픈) | **가능** | **fal.ai 기준 ~$0.003/장 (1MP), 1초 미만 지연** | 장면 일러스트의 기본 워크호스 |
| FLUX.2 [klein] 4B (2026-01) | Apache 2.0 | 가능 | 유사 | 자체 호스팅 시나리오용; 9B/dev 버전은 **비상업 — 주의** |
| **GPT Image 1 Mini / 1.5** | 상용 API | 가능 | **$0.005/장(저품질)~$0.17** | 모더레이션 내장이 장점, 수십 초 지연 — 사전 생성용으로만 |
| Imagen 4 (Google) | 상용 API | 가능 | $0.02–0.06/장 | GCP 결제 통합 이점 |
| **Ideogram 3.0 API** | 상용 API | 가능 | ~$0.03–0.09/장 | **이미지 안 텍스트** (메뉴판·표지판 등 과제 소품)에만 |
| Qwen-Image (20B) | Apache 2.0 | 가능 | 호스티드 제공 있음 | 오픈 모델 중 유일하게 **한국어 이미지 내 텍스트** 가능 |
| Ideogram 4 (오픈웨이트), FLUX dev, MusicGen 가중치 | **비상업** | **불가** | — | "오픈웨이트 ≠ 상업 사용 가능" — 라이선스 체크리스트 필수 |

핵심 수치: 과제 1건 저작 시 장면 후보 4장 생성 → FLUX schnell 기준 **$0.012**, GPT Image Mini 기준 $0.02. 교사가 월 20개 과제를 만들어도 **월 $0.24–0.4/교사**. 비용은 의사결정 변수가 아니다.

안전 주의점: fal/Replicate의 오픈 모델에는 모더레이션이 내장돼 있지 않다 — 자체 레이어(OpenAI moderation 또는 Hive)를 반드시 끼워야 한다. OpenAI/Google API는 내장 필터가 있어 미성년 노출 경로에선 이쪽이 기본값으로 안전하다.

## 2.2 오디오 생성 — TTS와 효과음

| 모델 | 라이선스 | Lingual 로케일 커버 | 단가 | 비고 |
| --- | --- | --- | --- | --- |
| **Kokoro-82M** | Apache 2.0 | 스페인어·프랑스어·한국어 포함 8개 | **DeepInfra ~$0.0008/분 (오디오 1시간에 $0.05)** | CPU로도 구동되는 초저가; 비영어 보이스 품질은 로케일별 검수 필요 |
| **Chatterbox Multilingual** | **MIT** | **23개 언어 — es/fr/ko/ru/he 커버 (tl 미지원)** | 호스티드/자체 호스팅 | 블라인드 테스트에서 ElevenLabs 대비 63.75% 선호; 감정 제어·워터마크 내장 |
| gpt-4o-mini-tts (현 코드) | 상용 API | 전체 | ~$0.015/분 | 현재 휴면 파이프라인의 기본값 — 그대로 시작해도 무방 |
| MisoTTS | 수정 MIT | **영어만** | 미정 | 현시점 부적합 (Part 0) |
| XTTS-v2, F5-TTS 일부 체크포인트, MMAudio | 비상업 | — | — | 사용 불가/체크포인트별 확인 필요 |
| Stable Audio Open (효과음/앰비언트) | 커뮤니티 라이선스 (**연매출 $1M 미만 무료**) | — | 자체 호스팅 또는 1회 생성 | 매출 성장 시 유료 전환 조건 — LIMITATIONS성 기록 필요 |
| ElevenLabs SFX API | 상용 API | — | 회당 ~$0.03 | 앰비언트 라이브러리 1회 구축엔 충분히 저렴 |

비용 비교의 핵심: **실시간 음성 대화(~$0.10–0.30/분) vs TTS 내레이션(~$0.001–0.015/분) — 약 10~100배 차이.** doc 20의 "과제 완료 후 자발 연장 연습은 텍스트 우선" 원칙에서, 텍스트 모드에 TTS 듣기(AI 대사·지문 낭독)를 입히면 **실시간 음성 원가의 1/10 이하로 '들리는' 연습 경험**을 만들 수 있다. 자발 연습 폭증 시나리오에서 좌석당 마진을 지키는 직접적 수단이다.

## 2.3 자체 호스팅 판정: 하지 않는다

- Cloud Run GPU(L4)는 시간당 약 $1.1–1.2 (GPU+필수 vCPU/메모리). 상시 워밍 1대 = **월 ~$850**.
- 학교 트래픽은 수업 시간대에 몰리는 버스트형 → 실효 가동률 5–15% 추정 → 실효 장당 비용 $0.02–0.10 + 운영 부담. **fal.ai의 정액 $0.003/장, 1초 미만, 운영 제로**가 압도한다.
- 손익분기는 대략 월 10만~50만 장 이상 — 현 단계에서 도달 불가능한 볼륨. TTS도 동일 논리 (DeepInfra Kokoro가 자체 L4 운용보다 싸다).
- **결론: 전 유스케이스를 호스티드 API로 시작하고, 프로바이더 추상화 레이어만 깔아둔다.** "오픈소스 모델 이용"의 실익은 자체 호스팅이 아니라 (a) 호스티드 단가가 싸고 (b) 벤더 종속 없이 갈아탈 수 있다는 옵션 가치다.

# Part 3. 효용 분석: 무엇이 북극성을 움직이는가

## 3.1 ① 저작 시점 장면 일러스트 — 최우선

- **무엇**: 교사가 과제를 만들 때 `generated_scenario`로부터 장면/에피소드 커버 이미지를 자동 생성, 교사가 4후보 중 선택·승인. 학생 연습 워크스페이스와 에피소드 목록에 표시.
- **효용 근거**: doc 20의 서사 전략(시즌/에피소드 구조)의 시각적 골격이다. 에피소드에 표지가 생기는 순간 "과제 목록"이 "이야기 목록"으로 지각된다. 듀얼 코딩 이론과 EFL 연구(시각 보조 → 어휘 파지 향상, 단 메타 수준 근거는 혼재)가 보조 근거.
- **왜 리스크가 낮은가**: 생성 주체가 교사, 노출 전 교사 승인, 학생당 생성 0회. LAUSD 사건의 구조(학생이 직접 생성)와 정반대. 모더레이션 실패조차 교사 화면에서 멈춘다.
- **비용**: 과제당 ~$0.01–0.04. 무시 가능.

## 3.2 ② 그림 묘사·서사 과제 타입 — 페다고지 직결

- **무엇**: 신규 task_type "picture description / picture narration" — 교사 승인 이미지(1장 또는 4컷 시퀀스)를 학생에게 제시하고, AI 튜터가 묘사·서사·추측을 유도("무슨 일이 일어나고 있어?", "다음에 무슨 일이?").
- **효용 근거**: 묘사(description)와 서사(narration)는 **ACTFL OPI가 평가하는 핵심 기능**이다. 즉 이 과제 타입은 엔터화 기능이 아니라 **공인 말하기 평가 형식의 디지털화**이고, 17번 문서의 한국 포지셔닝(수행평가 근거)과 미국 포지셔닝(proficiency 정렬) 모두에 꽂힌다. 생성 이미지를 스토리 리텔링 연습에 쓴 연구(RetAssist, 2024)도 긍정적 결과. 직접 근거는 아직 얇다는 점은 인지(리서치 플래그).
- **차별화**: 경쟁사 중 "교사가 설계한 이미지 기반 발화 과제"를 가진 곳은 확인되지 않았다. 이미지가 발화의 **입력**으로 쓰이는 모범 사례 — 학생은 보는 게 아니라 봐서 말한다.
- **언어 무관**: 이미지는 로케일 중립 자산이라 언어 추가 시 재사용된다 (locale-parametric 원칙과 정합).

## 3.3 ③ 저비용 TTS 레이어 — 비용 문제의 해법

- **무엇**: (a) 텍스트 모드 연습에서 AI 대사·서사 지문을 선택적으로 낭독, (b) doc 20의 "이야기 계속하기" 연장 모드의 기본 청각 경험, (c) 듣기 자료(지문·대화문) 생성.
- **효용 근거**: 텍스트 폴백 모드(동의 미비·예산 소진 시)의 경험 격차를 줄인다 — 현재는 음성 차단 = 무음 채팅. TTS를 입히면 "듣고 → 텍스트/음성으로 답하는" 준(準)음성 경험이 분당 $0.001 수준에서 가능. **자발 연습이 늘수록 비용이 터지는 doc 20 리스크 표의 '비용 폭주' 항목에 대한 구조적 해법.**
- **구현**: 휴면 `avatar_chat.py` TTS 경로 재사용 + 프로바이더 추상화(기본 gpt-4o-mini-tts → 검증 후 Kokoro/Chatterbox로 원가 절감). 신규 모달리티라기보다 기존 모달리티의 원가 혁신.

## 3.4 ④ 앰비언트 사운드 — 저비용 몰입 가산

장면 카테고리(카페, 거리, 공항, 시장 등) 30–50개의 배경음 루프를 1회 생성·구축해 시나리오에 매핑. 회당 ~$0.03, 총 ~$2의 고정비. 효용은 몰입 가산 수준이므로 ①–③ 이후 여력 시. 주의: 발화 청취를 방해하지 않도록 음량/끄기 기본 제공, Stable Audio Open 사용 시 매출 조건 기록.

## 3.5 보류 항목과 사유

- **⑤ 학생 트리거 실시간 이미지 생성** ("내가 말한 장면을 그려줘"): 매 호출이 모더레이션 실패 가능 지점이고(LAUSD 사건의 구조), 학생 수에 비례하는 변동비이며, 발화 시간을 이미지 구경 시간으로 치환한다. 세 기준 모두에서 탈락. 먼 후일 "내 이야기 그림책 만들기" 같은 산출물 기능으로 재검토 여지만 남긴다.
- **⑥ 음성 클로닝/커스텀 캐릭터 보이스**: 미성년 환경에서 음성 클로닝은 동의·오용 리스크 대비 효용이 불분명. 캐릭터 음색 다양화는 realtime API의 기본 보이스 옵션으로 충분.

## 3.6 "모달리티 2배" 프레임에 대한 판정

전략의 본질은 모달리티 개수가 아니다. 위 ①–④를 다 합쳐도 마케팅 문구는 "모달리티 2배"가 아니라 **"이야기가 보이고 들리는 말하기 연습"**이어야 하고, 지표는 모달리티 사용량이 아니라 **이미지/오디오가 추가된 과제의 발화 시간·완주율 델타**여야 한다. 이미지·오디오는 doc 20 서사 전략의 감각적 실행 수단으로 위치시킬 때 가장 효용이 크고, 독립 전략으로 세우면 비용은 작지만 초점 분산이라는 진짜 비용을 치른다.

# Part 4. 실행 권고

## 4.1 아키텍처 원칙

1. **사전 생성 + 교사 승인 게이트가 유일한 기본값.** 학생에게 노출되는 모든 생성 이미지는 (a) 프롬프트 단계 모더레이션 → (b) 출력 이미지 모더레이션(OpenAI omni-moderation 또는 Hive) → (c) 교사 명시 승인의 3중 게이트를 통과한 정적 자산이다. 런타임에 모델을 호출하는 학생 경로는 만들지 않는다.
2. **프로바이더 추상화**: `ImageGenProvider` / `TTSProvider` 인터페이스 뒤에 OpenAI·fal·DeepInfra를 숨긴다. 시작은 모더레이션 내장 API(GPT Image Mini), 볼륨·품질 검증 후 FLUX schnell로 단가 최적화. DI 컨테이너 패턴(backend/CLAUDE.md)에 정합.
3. **비용 계량 일원화**: 이미지·TTS 비용도 기존 `cost_summary` 구조에 합산해 "좌석당 모달리티 원가"를 파일럿 보고서에 쓸 수 있게 한다.
4. **이미지 자산은 신규 컬렉션이 아니라 assignment 문서의 자산 참조로** (GCS 저장 + URL). 신규 영속화 시스템 금지 원칙 준수.

## 4.2 단계별 실행과 공수 추정

| 단계 | 내용 | 공수 (1인 기준, 추정) | 선행 조건 |
| --- | --- | --- | --- |
| **M1** | 과제 빌더에 장면 이미지 생성·승인 (①): 백엔드 생성 엔드포인트 + 모더레이션 + GCS 저장 + 빌더 UI + 연습 화면 표시 | 1–2주 | 없음 — 즉시 가능 |
| **M2** | TTS 내레이션 재활성화 (③): avatar_chat TTS 경로 추출 → 텍스트 연습에 낭독 버튼/자동 낭독, 프로바이더 추상화 | 1주 | 없음 |
| **M3** | 그림 묘사 과제 타입 (②): task_type 추가 + 프롬프트 어셈블리 + 멀티 이미지(4컷) + 분석 이벤트 | 1–2주 | M1 |
| **M4** | 앰비언트 라이브러리 (④) + 오픈 TTS 원가 절감 (Kokoro/Chatterbox 로케일별 품질 검수 후 교체) | 1주 + 검수 | M2, doc 20 Phase 1 진행과 동기화 |

doc 20 로드맵과의 관계: M1–M2는 doc 20 Phase 0–1(서사 프레임 실험, 에피소드 구조)과 같은 분기에 병행 가능하며 상호 증폭된다(에피소드 구조 + 표지 이미지 + 내레이션 낭독 = 서사 경험의 최소 완성형).

## 4.3 조건·리스크·중단 기준

| 리스크 | 대응 / 중단 기준 |
| --- | --- |
| 부적절 이미지가 교사 게이트 통과 | 3중 게이트 + 사고 시 해당 프로바이더 즉시 차단 스위치. 학생 노출 사고 1건 = 기능 일시 중단 + 사후 분석이 기본 대응 |
| 라이선스 위반 (비상업 가중치 혼입) | 모델 도입 체크리스트(라이선스·로케일·단가) 문서화 — 본 문서 Part 2 표를 기준으로 유지보수 |
| TTS 품질이 로케일별로 불균질 | 오픈 TTS 교체는 로케일별 교사 청취 검수 통과 시에만; 미통과 로케일은 gpt-4o-mini-tts 유지 (추상화 레이어가 로케일별 라우팅 허용) |
| 이미지가 발화를 잠식 (구경 시간 증가) | 쌍지표 적용: 이미지 부착 과제의 발화 분·완주율이 무부착 대비 중립 이상이어야 유지. 하락 시 해당 표면 제거 |
| 모더레이션 비용·지연 | 저작 시점 생성이므로 지연 무관; 모더레이션 호출비는 이미지 단가에 합산해도 ~$0.01/장 수준 |
| Stable Audio 매출 조건 ($1M) | LIMITATIONS에 기록, 매출 접근 시 라이선스 전환 또는 ElevenLabs 대체 |

## Bottom Line

"오픈소스 이미지/오디오 모델로 모달리티를 배로"라는 가설은 **절반만 맞다.** 맞는 절반: 단가와 라이선스 지형이 2026년 중반 기준 충분히 성숙해서, 장당 $0.003–0.03·분당 $0.001 수준으로 이미지·오디오를 얹을 수 있고, 우리 스택(비용 계량, 휴면 TTS 파이프라인, 과제 저작 플로우)은 이를 받을 준비가 돼 있다. 틀린 절반: "오픈소스"(자체 호스팅은 월 10만 장 이하에선 손해, 진짜 효익은 호스티드 단가와 이탈 옵션)와 "모달리티 2배"(모달리티는 목표가 아니라 발화를 늘리는 입력 수단)라는 프레임.

권고: **M1(저작 시점 장면 이미지) + M2(TTS 내레이션)를 doc 20 Phase 0–1과 같은 분기에 병행 착수**한다. 두 작업 합계 2–3주 공수, 한계비용 무시 가능, 그리고 doc 20의 서사 전략에 시각·청각을 입혀 "교사 통제 × 학생 몰입" 사분면 점유를 가속한다. 학생 트리거 실시간 생성과 음성 클로닝은 명시적으로 만들지 않는다 — 그것이 LAUSD형 사고와 Character.AI형 리스크로부터 이 전략을 분리하는 선이다.

## Sources

모델·단가:

- [Miso Labs — MisoTTS 8B 공개 (2026-06-03)](https://www.misolabs.ai/blog/miso-tts-8b), [GitHub](https://github.com/MisoLabsAI/MisoTTS), [MarkTechPost](https://www.marktechpost.com/2026/06/04/miso-labs-releases-misotts-an-8b-emotive-text-to-speech-model-with-open-weights/)
- [Ideogram API 단가 (2차 출처 — 재확인 필요)](https://www.eesel.ai/blog/ideogram-pricing), [Segmind — Ideogram 3.0](https://blog.segmind.com/ideogram-3-0-on-segmind-features-api-pricing-and-use-cases/)
- [Ideogram 4 오픈웨이트 (비상업 라이선스)](https://github.com/ideogram-oss/ideogram4), [안전 문서](https://github.com/ideogram-oss/ideogram4/blob/main/docs/safety.md)
- [fal.ai FLUX 단가 (~$0.003/MP)](https://fal.ai/flux), [BFL 라이선스 (dev 비상업)](https://bfl.ai/licensing), [FLUX.2 klein 4B Apache (VentureBeat)](https://venturebeat.com/technology/black-forest-labs-launches-open-source-flux-2-klein-to-generate-ai-images-in)
- [Qwen-Image (Apache 2.0, 한국어 텍스트 렌더링)](https://qwenlm.github.io/blog/qwen-image/)
- [OpenAI API 단가 (GPT Image, TTS, Realtime)](https://openai.com/api/pricing/), [Imagen 4 단가 비교](https://intuitionlabs.ai/articles/ai-image-generation-pricing-google-openai)
- [Kokoro-82M @ DeepInfra ($0.80/1M자)](https://deepinfra.com/hexgrad/Kokoro-82M), [Chatterbox Multilingual (MIT, 23개 언어)](https://www.resemble.ai/learn/models/chatterbox-multilingual)
- [Stable Audio Open 라이선스](https://huggingface.co/stabilityai/stable-audio-open-1.0), [ElevenLabs SFX 단가](https://help.elevenlabs.io/hc/en-us/articles/25735337678481-How-much-does-it-cost-to-generate-sound-effects)
- [Cloud Run GPU 단가](https://cloud.google.com/run/pricing)

안전·페다고지:

- [CalMatters — LAUSD 초등 Adobe Express 선정 이미지 사건과 캘리포니아 가이드라인 (2026-02)](https://calmatters.org/economy/technology/2026/02/ai-images-scandalized-a-california-elementary-school-now-the-state-is-pushing-new-safeguards/)
- [NCMEC — 생성 AI 아동 안전 통계](https://www.missingkids.org/theissues/generative-ai)
- [FPF — Vetting Generative AI Tools for Use in Schools](https://fpf.org/wp-content/uploads/2024/10/Ed_AI_legal_compliance.pdf_FInal_OCT24.pdf)
- [COPPA 2025 최종 규칙 실무 가이드](https://blog.promise.legal/startup-central/coppa-compliance-in-2025-a-practical-guide-for-tech-edtech-and-kids-apps/)
- [ACTFL OPI Familiarization Guide (묘사·서사 기능)](https://www.actfl.org/uploads/files/general/OPI-Familiarization-Guide-2020-1.pdf)
- [RetAssist — 생성 이미지 기반 스토리 리텔링 연습 (2024)](https://arxiv.org/pdf/2405.14794)
- [EFL 시각 보조와 어휘 학습 (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8963493/)

내부 문서:

- `20-zeta-engagement-strategy-research.md` (서사 전략 — 본 문서의 모(母) 전략)
- `backend/routes/chat.py` (realtime 모델), `backend/avatar_chat.py` (휴면 TTS/STT), `backend/services/assignment_resolver.py` (voice_minutes_cap)
- `docs/school-integration/PRD.md` §8.8 (비용 통제), §4.4 (하이브리드 모달리티 원칙)
