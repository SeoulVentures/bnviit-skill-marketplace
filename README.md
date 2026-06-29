# bnviit-skill-marketplace

비앤빛 안과(BNVIIT)의 **Claude Cowork**를 위한 스킬 마켓플레이스입니다.
운영·상담·마케팅 등 병원 업무를 돕는 Claude Code 스킬을 플러그인 형태로 모아 배포합니다.

## 비앤빛 RAG 메모리 설치 (bnviit-rag)

비앤빛 안과 업무 지식을 로컬 RAG로 색인해 의미 검색을 제공하는 플러그인입니다.

1단계: `/plugin install bnviit-rag@bnviit-skill-marketplace`

2단계: `/bnviit-setup` (또는 "비앤빛안과를 위한 스킬을 설치하라")

---

## 마켓플레이스 추가하기

Claude Code에서 아래 명령으로 이 마켓플레이스를 등록합니다.

```
/plugin marketplace add SeoulVentures/bnviit-skill-marketplace
```

등록 후 플러그인을 설치합니다.

```
/plugin install bnviit-clinic@bnviit-skill-marketplace
```

## 저장소 구조

```
bnviit-skill-marketplace/
├── .claude-plugin/
│   └── marketplace.json          # 마켓플레이스 정의 (플러그인 목록)
├── plugins/
│   └── bnviit-clinic/            # 플러그인 하나
│       ├── .claude-plugin/
│       │   └── plugin.json        # 플러그인 메타데이터
│       └── skills/
│           └── patient-faq-reply/ # 스킬 하나
│               └── SKILL.md
└── README.md
```

## 새 스킬 추가하기

1. 해당 플러그인의 `skills/` 아래에 새 디렉터리를 만듭니다: `skills/<skill-name>/`
2. 그 안에 `SKILL.md`를 작성합니다. 프런트매터에 `name`과 `description`은 필수입니다.

   ```markdown
   ---
   name: my-skill
   description: 이 스킬이 언제 트리거되어야 하는지 구체적으로 작성합니다.
   ---

   # 스킬 본문
   ```

3. 필요하면 보조 파일(스크립트, 참고 문서)을 같은 디렉터리에 둡니다.

## 새 플러그인 추가하기

1. `plugins/<plugin-name>/` 디렉터리와 `.claude-plugin/plugin.json`을 만듭니다.
2. `.claude-plugin/marketplace.json`의 `plugins` 배열에 항목을 추가합니다.

   ```json
   {
     "name": "<plugin-name>",
     "source": "./plugins/<plugin-name>",
     "description": "플러그인 설명"
   }
   ```

## 라이선스

내부 사용 (SeoulVentures / 비앤빛 안과).
