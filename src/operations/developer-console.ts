import { errorTotals } from './error-metrics';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermission } from '../common/auth';
import { AppException } from '../common/app-exception';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  type DevForm,
  type DevLocation,
  type DevRow,
  type DevView,
} from '../shared/domain/developer-console';
import { can, ROLE_LABEL, ROLE_ORDER, PERMISSIONS, PERMISSION_LABEL } from '../shared/domain/permissions';
import {
  activities,
  controls,
  defaults,
  roleProfile,
  binding,
  staffPermissions,
  settingsKey,
} from './developer-controls';
import { recentServerLogs } from './server-logs';

const input = z.object({
  section: z.enum(['permissions', 'logs', 'security', 'operations', 'system']),
  item: z.string().max(200).default(''),
  search: z.string().max(120).default(''),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});
const command = z.object({
  command: z.enum([
    'save-role',
    'delete-role',
    'assign-role',
    'save-controls',
    'revoke',
    'refresh-stats',
    'clear-stats',
  ]),
  id: z.string().max(160).default(''),
  version: z.number().int().min(0).default(0),
  values: z.record(z.string().max(64), z.string().max(512)).default({}),
});
const pageSize = 40;
const stamp = (d: Date | string) =>
  new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(d));
const missing = () => new AppException('NOT_FOUND', '항목을 찾을 수 없습니다.');
const stale = () => new AppException('CONFLICT', '다른 개발자가 변경했습니다. 새로고침해 주세요.');
const roleKey = /^dev:role:[a-f0-9-]{36}$/;
const activityOptions = Object.entries(activities).map(([value, label]) => ({ value, label }));
const next = (section: DevLocation['section'], item = ''): DevLocation => ({ section, item });
const go = (title: string, section: DevLocation['section'], item = '', detail?: string): DevRow => ({
  title,
  detail,
  next: next(section, item),
});
const statsKey = 'dev:stats:v1';

@Controller('admin/developer')
@RequirePermission('developer.access')
export class DeveloperConsole {
  constructor(
    private db: PrismaService,
    private redis: RedisService,
    private audit: AuditService,
  ) {}
  @Get('view')
  @RequirePermission('developer.view')
  async view(
    @CurrentUser() actor: User,
    @Query(new ZodPipe(input)) q: z.infer<typeof input>,
  ): Promise<DevView> {
    const writable = can(actor, 'developer.access');
    if (!writable && q.section === 'permissions' && q.item === 'new') throw new AppException('FORBIDDEN');
    const view = await this.section(q);
    if (writable) return view;

    // 조회 전용 응답에도 현재 설정값을 제공한다.
    const { forms, groups, ...rest } = view;
    const visibleGroups = groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => !(row.next?.section === 'permissions' && row.next.item === 'new')),
    }));
    for (const form of forms ?? []) {
      if (!form.fields?.length) continue;
      visibleGroups.push({
        title: '현재 설정',
        rows: form.fields.map((field) => {
          const values = field.multiple ? field.value.split(',') : [field.value];
          const detail = values.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ');
          return { title: field.label, detail: detail || '없음' };
        }),
      });
    }
    return { ...rest, groups: visibleGroups };
  }

  private async section(q: z.infer<typeof input>): Promise<DevView> {
    switch (q.section) {
      case 'permissions':
        return this.permissions(q);
      case 'logs':
        return this.logs(q);
      case 'security':
        return this.security(q);
      case 'operations':
        return this.operations(q);
      case 'system':
        return this.system();
    }
  }

  private async permissions(q: z.infer<typeof input>): Promise<DevView> {
    const roles = await this.db.siteSettings.findMany({
      where: { id: { startsWith: 'dev:role:' } },
      orderBy: { id: 'asc' },
    });
    if (q.item === 'staff') {
      const users = await this.db.user.findMany({
        where: {
          roles: { has: 'staff' },
          NOT: { roles: { hasSome: ['admin', 'developer'] } },
          status: 'active',
          name: { contains: q.search, mode: 'insensitive' },
        },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: q.page * pageSize,
        take: pageSize + 1,
      });
      return {
        title: '직원별 권한',
        searchLabel: '직원 이름 검색',
        hasMore: users.length > pageSize,
        groups: [
          {
            title: '센터 직원',
            rows: users.slice(0, pageSize).map((u) => go(u.name, 'permissions', 'user:' + u.id)),
          },
        ],
      };
    }
    if (q.item.startsWith('user:')) {
      const id = q.item.slice(5),
        u = await this.db.user.findUnique({
          where: { id },
          select: { name: true, roles: true, status: true },
        });
      if (
        !u ||
        !u.roles.includes('staff') ||
        u.roles.some((r) => r === 'developer' || r === 'admin') ||
        u.status !== 'active'
      )
        throw missing();
      const row = await this.db.siteSettings.findUnique({ where: { id: 'dev:user:' + id } });
      return {
        title: u.name,
        groups: [
          { title: '역할', rows: [{ title: '센터 직원', detail: '직원 기본 권한 안에서 적용합니다.' }] },
        ],
        forms: [
          {
            command: 'assign-role',
            id,
            version: row?.version ?? 0,
            label: '권한 저장',
            message: '선택한 역할을 이 직원의 모든 기기에 적용할까요?',
            fields: [
              {
                key: 'roleId',
                label: '적용할 역할',
                value: row ? binding.parse(row.values).roleId : '',
                options: [
                  { value: '', label: '직원 기본 권한' },
                  ...roles.map((r) => ({ value: r.id, label: roleProfile.parse(r.values).label })),
                ],
              },
            ],
          },
        ],
      };
    }
    if (ROLE_ORDER.some((r) => r === q.item)) {
      const role = ROLE_ORDER.find((r) => r === q.item)!;
      return {
        title: ROLE_LABEL[role],
        groups: [
          {
            title: '기본 역할 · 허용 기능',
            rows: PERMISSIONS.filter((p) => can({ roles: [role], status: 'active' }, p)).map((p) => ({
              title: PERMISSION_LABEL[p],
              detail: p,
            })),
          },
        ],
      };
    }
    if (q.item === 'new' || roleKey.test(q.item)) {
      const r = roles.find((x) => x.id === q.item);
      if (!r && q.item !== 'new') throw missing();
      const def = r
        ? roleProfile.parse(r.values)
        : { label: '', description: '', permissions: ['admin.access'] };
      const form: DevForm = {
        label: r ? '역할 수정' : '역할 추가',
        command: 'save-role',
        id: r?.id,
        version: r?.version ?? 0,
        message: '역할 설정을 저장할까요?',
        fields: [
          { key: 'label', label: '이름', value: def.label },
          { key: 'description', label: '설명', value: def.description },
          {
            key: 'permissions',
            label: '허용 기능',
            value: def.permissions.join(','),
            multiple: true,
            options: staffPermissions
              .filter((p) => p !== 'admin.access')
              .map((p) => ({ value: p, label: PERMISSION_LABEL[p] })),
          },
        ],
      };
      return {
        title: r ? def.label : '사용자 정의 역할',
        groups: [
          {
            title: '적용 범위',
            rows: [{ title: '센터 직원', detail: '관리자 화면 접근은 기본으로 포함됩니다.' }],
          },
        ],
        forms: [
          form,
          ...(r
            ? [
                {
                  command: 'delete-role',
                  id: r.id,
                  version: r.version,
                  label: '역할 삭제',
                  destructive: true,
                  message: '사용하지 않는 역할을 삭제할까요?',
                },
              ]
            : []),
        ],
      };
    }
    if (q.item) throw missing();
    return {
      title: '권한 관리',
      groups: [
        { title: '기본 역할', rows: ROLE_ORDER.map((r) => go(ROLE_LABEL[r], 'permissions', r)) },
        {
          title: '사용자 정의 역할',
          rows: [
            ...roles.map((r) =>
              go(
                roleProfile.parse(r.values).label,
                'permissions',
                r.id,
                roleProfile.parse(r.values).description,
              ),
            ),
            go('역할 추가', 'permissions', 'new'),
          ],
        },
        { title: '권한 적용', rows: [go('직원별 권한', 'permissions', 'staff')] },
      ],
    };
  }

  private async security(q: z.infer<typeof input>): Promise<DevView> {
    const active = { expiresAt: { gt: new Date() }, user: { status: 'active' as const } };
    if (q.item) {
      const sessions = await this.db.session.findMany({
        where: { ...active, userId: q.item },
        select: {
          createdAt: true,
          expiresAt: true,
          userAgent: true,
          user: { select: { name: true, roles: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: q.page * pageSize,
        take: pageSize + 1,
      });
      if (!sessions.length) throw missing();
      return {
        title: sessions[0]!.user.name,
        interval: 15000,
        hasMore: sessions.length > pageSize,
        groups: [
          {
            title: '로그인 기기',
            rows: sessions.slice(0, pageSize).map((s) => ({
              title:
                s.userAgent?.match(/iPhone|iPad|Android|Macintosh|Windows|CFNetwork/i)?.[0] ?? '로그인 기기',
              detail: '로그인 ' + stamp(s.createdAt),
              value: '만료 ' + stamp(s.expiresAt),
            })),
          },
        ],
        forms: [
          {
            label: '모든 기기 로그아웃',
            command: 'revoke',
            id: q.item,
            destructive: true,
            message: '이 계정의 모든 기기에서 즉시 로그아웃할까요?',
          },
        ],
      };
    }
    const users = await this.db.user.findMany({
      where: {
        status: 'active',
        name: { contains: q.search, mode: 'insensitive' },
        sessions: { some: { expiresAt: active.expiresAt } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: q.page * pageSize,
      take: pageSize + 1,
      select: {
        id: true,
        name: true,
        roles: true,
        _count: { select: { sessions: { where: { expiresAt: active.expiresAt } } } },
      },
    });
    return {
      title: '세션·보안',
      interval: 15000,
      searchLabel: '이름 검색',
      hasMore: users.length > pageSize,
      groups: [
        {
          title: '현재 로그인한 계정',
          rows: users.slice(0, pageSize).map((u) => ({
            ...go(u.name, 'security', u.id, u.roles.map((r) => ROLE_LABEL[r]).join(' · ')),
            value: u._count.sessions + '개 기기',
          })),
        },
      ],
    };
  }

  private async logs(q: z.infer<typeof input>): Promise<DevView> {
    const [kind, id] = q.item.split('/');
    if (!kind)
      return {
        title: '로그',
        groups: [
          {
            title: '기록',
            rows: [
              go('감사 로그', 'logs', 'audit'),
              go('서버 요청', 'logs', 'requests'),
              go('오류 로그', 'logs', 'errors'),
              go('자주 발생한 오류', 'logs', 'top'),
            ],
          },
        ],
      };
    if (kind === 'audit') {
      if (id) {
        const e = await this.db.auditEvent.findUnique({ where: { id } });
        if (!e) throw missing();
        const change = await this.db.siteSettings.findUnique({ where: { id: 'dev:change:' + e.id } });
        const diff = change
          ? z.object({ before: z.string(), after: z.string() }).parse(change.values)
          : undefined;
        return {
          title: '감사 이벤트 상세',
          groups: [
            {
              title: e.action,
              rows: [
                { title: '내용', detail: e.summary },
                { title: '실행자', value: e.actorName },
                { title: '시각', value: stamp(e.at) },
                { title: '대상', detail: e.targetType + ' · ' + e.targetId },
                ...(diff
                  ? [
                      { title: '변경 전', detail: diff.before },
                      { title: '변경 후', detail: diff.after },
                    ]
                  : []),
              ],
            },
          ],
        };
      }
      const entries = await this.db.auditEvent.findMany({
        where: q.search
          ? {
              OR: [
                { action: { contains: q.search } },
                { summary: { contains: q.search } },
                { actorName: { contains: q.search } },
              ],
            }
          : {},
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: q.page * pageSize,
        take: pageSize + 1,
      });
      return {
        title: '감사 로그',
        interval: 10000,
        searchLabel: '작업·실행자 검색',
        hasMore: entries.length > pageSize,
        groups: [
          {
            title: '최근 작업',
            rows: entries
              .slice(0, pageSize)
              .map((e) => go(e.summary, 'logs', 'audit/' + e.id, e.actorName + ' · ' + stamp(e.at))),
          },
        ],
      };
    }
    const snapshot = recentServerLogs();
    if (kind === 'top' || kind === 'top30') {
      const period = kind === 'top30' ? 30 : 7;
      const totals = await errorTotals(this.redis, period);
      if (q.search) {
        const data = totals.get(q.search);
        if (!data) throw missing();
        return {
          title: '오류 상세',
          groups: [
            {
              title: q.search,
              rows: [
                { title: '발생 횟수', value: data.total + '건' },
                { title: '최근 요청 보기', next: { section: 'logs', item: 'errors', search: q.search } },
              ],
            },
            { title: '날짜별 건수', rows: data.days.map((d) => ({ title: d.date, value: d.count + '건' })) },
          ],
        };
      }
      return {
        title: '자주 발생한 오류',
        interval: 10000,
        groups: [
          { title: '집계 기간', rows: [go('최근 7일', 'logs', 'top'), go('최근 30일', 'logs', 'top30')] },
          {
            title: '최근 ' + period + '일 · 많이 발생한 순',
            rows: [...totals]
              .sort((a, b) => b[1].total - a[1].total)
              .slice(q.page * pageSize, (q.page + 1) * pageSize)
              .map(([signature, data]) => ({
                title: signature,
                value: data.total + '건',
                next: { section: 'logs', item: kind + '/detail', search: signature },
              })),
          },
        ],
        hasMore: totals.size > (q.page + 1) * pageSize,
      };
    }
    if (kind !== 'requests' && kind !== 'errors') throw missing();
    if (id) {
      const e = snapshot.entries.find((e) => e.id === id);
      if (!e) throw missing();
      return {
        title: '요청 상세',
        groups: [
          {
            title: e.method,
            rows: [
              { title: '경로', detail: e.route },
              { title: '응답', value: String(e.status) },
              { title: '응답 시간', value: e.durationMs + ' ms' },
              { title: '시각', value: stamp(e.at) },
              { title: '요청 ID', detail: e.id },
            ],
          },
        ],
      };
    }
    const filtered = snapshot.entries.filter(
      (e) =>
        (kind !== 'errors' || e.status >= 400) &&
        (e.status + ' ' + e.method + ' ' + e.route).toLowerCase().includes(q.search.toLowerCase()),
    );
    return {
      title: kind === 'requests' ? '서버 요청' : '오류 로그',
      interval: 10000,
      searchLabel: '상태·메서드·경로 검색',
      hasMore: filtered.length > (q.page + 1) * pageSize,
      groups: [
        {
          title: '서버 요청 기록',
          rows: filtered.slice(q.page * pageSize, (q.page + 1) * pageSize).map((e) => ({
            ...go(
              e.method + ' ' + e.route,
              'logs',
              kind + '/' + e.id,
              stamp(e.at) + ' · ' + e.durationMs + ' ms',
            ),
            value: String(e.status),
          })),
        },
      ],
    };
  }

  private async operations(q: z.infer<typeof input>): Promise<DevView> {
    const row = await this.db.siteSettings.findUnique({ where: { id: settingsKey } });
    const c = row ? controls.parse(row.values) : defaults;
    if (q.item === 'settings') {
      return {
        title: '접수 운영 설정',
        groups: [],
        forms: [
          {
            command: 'save-controls',
            version: row?.version ?? 0,
            label: '운영 설정 저장',
            message: '변경한 접수 정책이 즉시 적용됩니다. 저장할까요?',
            fields: [
              {
                key: 'maintenance',
                label: '유지보수 모드',
                value: String(c.maintenance),
                options: [
                  { value: 'false', label: '해제' },
                  { value: 'true', label: '점검 중' },
                ],
              },
              { key: 'message', label: '점검 안내', value: c.message },
              {
                key: 'targets',
                label: '점검 대상',
                value: c.targets.join(','),
                multiple: true,
                options: activityOptions,
              },
              {
                key: 'disabled',
                label: '접수를 중단할 기능',
                value: c.disabled.join(','),
                multiple: true,
                options: activityOptions,
              },
            ],
          },
        ],
      };
    }
    if (q.item) throw missing();
    return {
      title: '운영',
      groups: [
        {
          title: '접수 제어',
          rows: [
            {
              ...go('유지보수 모드', 'operations', 'settings', c.maintenance ? c.message : undefined),
              value: c.maintenance ? '점검 중' : '해제',
            },
            ...activityOptions.map((o) => ({
              ...go(o.label, 'operations', 'settings'),
              value:
                c.disabled.some((x) => x === o.value) ||
                (c.maintenance && c.targets.some((x) => x === o.value))
                  ? '중단'
                  : '접수 가능',
            })),
          ],
        },
        {
          title: '모니터링',
          rows: [
            go('요청 로그', 'logs', 'requests'),
            go('오류 로그', 'logs', 'errors'),
            go('자주 발생한 오류', 'logs', 'top'),
          ],
        },
        { title: '통계', rows: [go('시스템 사용량', 'system')] },
      ],
      forms: [
        {
          command: 'clear-stats',
          label: '통계 캐시 초기화',
          message: '서버 사용량 통계 캐시를 지울까요? 다음 조회 때 다시 계산합니다.',
        },
        {
          command: 'refresh-stats',
          label: '통계 데이터 동기화',
          message: '현재 센터 데이터로 시스템 통계를 다시 계산할까요?',
        },
      ],
    };
  }
  private async counts() {
    const [users, clubs, programs, applications, reservations] = await Promise.all([
      this.db.user.count(),
      this.db.club.count(),
      this.db.program.count(),
      this.db.programApplication.count(),
      this.db.spaceReservation.count(),
    ]);
    return {
      회원: users,
      동아리: clubs,
      프로그램: programs,
      '프로그램 신청': applications,
      '공간 예약': reservations,
    };
  }
  private async system(): Promise<DevView> {
    const [db, redis] = await Promise.allSettled([this.db.$queryRaw`SELECT 1`, this.redis.ping()]);
    let counts: Record<string, number> = {};
    if (db.status === 'fulfilled') {
      const cached = redis.status === 'fulfilled' ? await this.redis.get(statsKey) : null;
      if (cached) counts = JSON.parse(cached) as Record<string, number>;
      else {
        counts = await this.counts();
        if (redis.status === 'fulfilled') await this.redis.set(statsKey, JSON.stringify(counts), 'EX', 30);
      }
    }
    return {
      title: '시스템',
      interval: 10000,
      groups: [
        {
          title: '연결 상태',
          rows: [
            { title: 'API', value: '정상' },
            { title: 'PostgreSQL', value: db.status === 'fulfilled' ? '정상' : '연결 오류' },
            { title: 'Redis', value: redis.status === 'fulfilled' ? '정상' : '연결 오류' },
            { title: '서버 시작', value: stamp(recentServerLogs().startedAt!) },
          ],
        },
        {
          title: '사용량',
          rows: Object.entries(counts).map(([title, n]) => ({ title, value: n.toLocaleString('ko-KR') })),
        },
        { title: '권한 구조', rows: ROLE_ORDER.map((r) => go(ROLE_LABEL[r], 'permissions', r)) },
      ],
    };
  }
  @Post('actions')
  async action(@CurrentUser() actor: User, @Body(new ZodPipe(command)) data: z.infer<typeof command>) {
    const { id, values: v, version } = data;
    if (data.command === 'refresh-stats' || data.command === 'clear-stats') {
      if (data.command === 'clear-stats') await this.redis.del(statsKey);
      else await this.redis.set(statsKey, JSON.stringify(await this.counts()), 'EX', 30);
      await this.audit.record(actor, {
        action: 'developer.' + data.command,
        targetType: 'site_settings',
        targetId: statsKey,
        summary: data.command === 'clear-stats' ? '통계 캐시 초기화' : '시스템 사용량 동기화',
      });
      return {};
    }
    return this.db.$transaction(async (tx) => {
      // 설정, 역할 할당과 미사용 역할 삭제가 동시에 진행될 때도 하나의 변경으로 기록한다.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(650066)`;
      const originalKey =
        data.command === 'assign-role'
          ? 'dev:user:' + id
          : data.command === 'save-controls'
            ? settingsKey
            : roleKey.test(id)
              ? id
              : '';
      const original = originalKey ? await tx.siteSettings.findUnique({ where: { id: originalKey } }) : null;
      const save = async (key: string, values: Record<string, string | boolean | string[]>) => {
        const changed =
          version === 0
            ? await tx.siteSettings.createMany({
                data: [{ id: key, values, version: 1 }],
                skipDuplicates: true,
              })
            : await tx.siteSettings.updateMany({
                where: { id: key, version },
                data: { values, version: version + 1 },
              });
        if (!changed.count) throw stale();
      };
      const split = (key: string) => [...new Set((v[key] ?? '').split(',').filter(Boolean))];
      let summary = '',
        target = id;
      switch (data.command) {
        case 'save-role': {
          if (id && !roleKey.test(id)) throw missing();
          const def = roleProfile.safeParse({
            label: v.label,
            description: v.description ?? '',
            permissions: [...new Set(['admin.access', ...split('permissions')])],
          });
          if (!def.success) throw new AppException('VALIDATION', '역할 이름과 허용 기능을 확인해 주세요.');
          target = id || 'dev:role:' + randomUUID();
          await save(target, def.data);
          summary = '직원 권한 역할 저장 · ' + def.data.label;
          break;
        }
        case 'delete-role': {
          if (!roleKey.test(id)) throw missing();
          const inUse = await tx.siteSettings.count({
            where: { id: { startsWith: 'dev:user:' }, values: { path: ['roleId'], equals: id } },
          });
          if (inUse)
            throw new AppException('CONFLICT', '이 역할을 사용하는 직원의 권한을 먼저 변경해 주세요.');
          if (!(await tx.siteSettings.deleteMany({ where: { id, version } })).count) throw stale();
          summary = '미사용 직원 역할 삭제';
          break;
        }
        case 'assign-role': {
          const u = await tx.user.findUnique({ where: { id } });
          if (
            !u ||
            id === actor.id ||
            !u.roles.includes('staff') ||
            u.roles.some((r) => r === 'admin' || r === 'developer') ||
            u.status !== 'active'
          )
            throw new AppException('FORBIDDEN', '활성 센터 직원에게만 적용할 수 있습니다.');
          const roleId = v.roleId ?? '';
          target = 'dev:user:' + id;
          if (roleId) {
            if (!roleKey.test(roleId) || !(await tx.siteSettings.findUnique({ where: { id: roleId } })))
              throw missing();
            await save(target, { roleId });
          } else if (version > 0) {
            if (!(await tx.siteSettings.deleteMany({ where: { id: target, version } })).count) throw stale();
          } else if (await tx.siteSettings.findUnique({ where: { id: target } })) throw stale();
          summary = '직원 권한 적용 · ' + u.name;
          break;
        }
        case 'save-controls': {
          const parsed = controls.safeParse({
            maintenance: v.maintenance === 'true',
            message: v.message,
            targets: split('targets'),
            disabled: split('disabled'),
          });
          if (!parsed.success || !['true', 'false'].includes(v.maintenance ?? ''))
            throw new AppException('VALIDATION', '안내 문구와 한 개 이상의 점검 대상을 입력해 주세요.');
          target = settingsKey;
          await save(target, parsed.data);
          summary = '접수 점검·기능 설정 변경';
          break;
        }
        case 'revoke': {
          const u = await tx.user.findUnique({ where: { id }, select: { name: true } });
          if (!u) throw missing();
          await tx.session.deleteMany({ where: { userId: id } });
          summary = '모든 로그인 기기 종료 · ' + u.name;
          break;
        }
      }
      const latest =
        data.command === 'revoke' ? null : await tx.siteSettings.findUnique({ where: { id: target } });
      await this.audit.record(
        actor,
        {
          action: 'developer.' + data.command,
          targetType: data.command === 'revoke' ? 'user' : 'site_settings',
          targetId: target,
          summary,
        },
        tx,
        data.command === 'revoke'
          ? undefined
          : {
              before: original ? JSON.stringify(original.values, null, 2) : '없음',
              after: latest ? JSON.stringify(latest.values, null, 2) : '없음',
            },
      );
      return {};
    });
  }
}
