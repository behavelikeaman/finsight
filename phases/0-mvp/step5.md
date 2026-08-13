# Step 5: supabase-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL — 원본 30일 삭제, RLS 필수)
- `/docs/ARCHITECTURE.md` (저장 정책 절)
- `/docs/ADR.md` (특히 ADR-005, ADR-008, ADR-009)
- `/src/types/` 전체

## 작업

Supabase 스키마를 SQL 마이그레이션으로 작성하고, 서버/클라이언트 Supabase 래퍼를 만든다.

### 마이그레이션 파일

`supabase/migrations/0001_initial.sql`에 작성한다. Supabase CLI를 설치할 필요는 없다 — SQL 파일만 준비하면 사용자가 대시보드나 CLI로 적용한다.

#### 테이블

**`profiles`** — `auth.users` 확장
- `id uuid primary key references auth.users(id) on delete cascade`
- `tier text not null default 'free' check (tier in ('free','paid'))`
- `created_at timestamptz not null default now()`

**`column_mappings`** — 카드사 지문별 컬럼 매핑 (ADR-003)
- `fingerprint text primary key`
- `issuer_label text not null`
- `header_row_index int not null`
- `date_column int not null`, `merchant_column int not null`, `amount_column int not null`
- `encoding text not null check (encoding in ('utf-8','cp949'))`
- `date_format text not null`
- `created_at timestamptz not null default now()`

이 테이블은 **전역 공유**다. 개인정보가 없고, 한 사용자의 추론 결과가 다른 사용자에게도 유효하다. RLS는 "인증 사용자 읽기 가능, 쓰기는 service role만"으로 건다.

**`uploads`** — 업로드 1건
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `storage_path text` — 원본 CSV 경로. 30일 후 삭제되면 null
- `fingerprint text references column_mappings(fingerprint)`
- `transaction_count int not null`
- `created_at timestamptz not null default now()`
- `original_deleted_at timestamptz` — 원본 삭제 시각 기록 (ADR-005 감사용)

**`transactions`** — 정규화 거래
- `id uuid primary key`
- `upload_id uuid not null references uploads(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `date date not null`
- `merchant text not null`
- `amount bigint not null` — 원 단위 정수
- 인덱스: `(user_id, date)`

`rawRow`는 **DB에 저장하지 않는다.** 이유: 원본 행에는 카드번호 등 우리가 쓰지 않는 항목이 들어있고, ADR-005의 취지는 그 노출면을 줄이는 것이다. `rawRow`는 파싱 세션 안에서만 존재한다.

**`classifications`**
- `transaction_id uuid primary key references transactions(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label text not null check (label in ('business','personal','uncertain'))`
- `account_code text`
- `confidence real not null`
- `reason text not null`
- `source text not null check (source in ('ai','rule'))`
- `edited_by_user boolean not null default false`
- `updated_at timestamptz not null default now()`

**`user_rules`** (ADR-008)
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `match_type text not null check (match_type in ('merchant_exact','merchant_contains'))`
- `pattern text not null`
- `label text not null check (label in ('business','personal','uncertain'))`
- `account_code text`
- `created_at timestamptz not null default now()`
- unique: `(user_id, match_type, pattern)`

**`usage_counters`** (ADR-009)
- `user_id uuid not null references auth.users(id) on delete cascade`
- `period text not null` — `YYYY-MM`
- `analyses int not null default 0`
- `chat_messages int not null default 0`
- primary key `(user_id, period)`

**`anonymous_trials`** (ADR-012)
- `fingerprint_hash text primary key` — IP + UA 기반 해시. 원본 IP를 저장하지 마라
- `used_at timestamptz not null default now()`

#### RLS

**모든 테이블에 `enable row level security`를 건다.** 예외 없다.

- `profiles`, `uploads`, `transactions`, `classifications`, `user_rules`, `usage_counters`: `auth.uid() = user_id` (profiles는 `auth.uid() = id`)로 select/insert/update/delete 정책
- `column_mappings`: authenticated 롤 select 허용, insert/update는 정책 없음(service role만)
- `anonymous_trials`: 정책 없음(service role만). 클라이언트가 접근할 이유가 없다

#### Storage

`uploads` 버킷을 private으로 만드는 SQL과, 경로 규칙 `{user_id}/{upload_id}.csv`를 주석으로 문서화한다.

#### 30일 삭제

`supabase/migrations/0002_retention.sql`에 원본 삭제 함수를 작성한다.

```sql
create or replace function delete_expired_originals() returns void
```

`created_at < now() - interval '30 days' and storage_path is not null`인 uploads의 스토리지 객체를 삭제하고, `storage_path`를 null로, `original_deleted_at`을 now()로 설정한다.

`pg_cron`으로 하루 1회 스케줄하는 SQL을 주석으로 남기되, 실행은 하지 마라 — 프로젝트 설정에 따라 확장 활성화가 필요하며 사용자 개입 사항이다.

### 코드

**`src/services/supabase/server.ts`** — `@supabase/ssr`의 서버 클라이언트. `import "server-only"` 필수.
**`src/services/supabase/client.ts`** — 브라우저 클라이언트. anon 키만 사용.
**`src/services/supabase/admin.ts`** — service role 클라이언트. `import "server-only"` 필수.

`SUPABASE_SERVICE_ROLE_KEY`는 `NEXT_PUBLIC_` 접두사를 절대 붙이지 마라.

**`src/types/database.ts`** — 위 스키마에 대응하는 TS 타입을 손으로 작성한다. Supabase 타입 생성 CLI는 실제 프로젝트 연결이 필요하므로 이 step에서는 쓰지 않는다.

### 테스트

DB 연결 없이 검증 가능한 것만 테스트한다: `database.ts` 타입이 `src/types/`의 도메인 타입과 필드 단위로 대응하는지 확인하는 타입 레벨 테스트.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 기존 테스트 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 모든 테이블에 RLS가 활성화되어 있는가?
   - `transactions`에 `raw_row` 컬럼이 없는가?
   - service role 키가 `NEXT_PUBLIC_`으로 노출되지 않는가?
   - Supabase 래퍼가 `src/services/supabase/`에 있는가?
3. SQL 파일을 눈으로 검토해 각 테이블의 RLS 정책이 빠짐없이 작성되었는지 확인한다.
4. 결과에 따라 `phases/0-mvp/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Supabase 프로젝트 생성·마이그레이션 적용) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- RLS 없이 테이블을 만들지 마라. 이유: 한 사용자가 다른 사용자의 거래내역을 읽을 수 있게 된다.
- `transactions`에 원본 행(`raw_row`)을 저장하지 마라. 이유: ADR-005의 노출면 축소 취지에 정면으로 반한다.
- `SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` 접두사를 붙이지 마라. 이유: 클라이언트 번들에 포함되어 RLS가 통째로 무력화된다.
- `anonymous_trials`에 원본 IP를 저장하지 마라. 해시만 저장한다.
- 실제 Supabase 프로젝트에 마이그레이션을 적용하려 시도하지 마라. SQL 파일 작성까지가 이 step의 범위다.
- 기존 테스트를 깨뜨리지 마라
