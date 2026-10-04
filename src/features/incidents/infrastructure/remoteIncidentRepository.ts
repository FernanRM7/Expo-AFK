import type { IncidentCategory, IncidentStatus } from '../../../campusops/contracts';
import { parseRemoteResource } from '../../../course-evaluation';
import type { FetchResult, ParseResult } from '../../../course-evaluation/contracts';
import { fetchJson } from '../../../api/cloudClient';
import type {
    CreateIncidentInput,
    IncidentRepository,
    IncidentSnapshot,
} from '../domain/incidentRepository';

const CATEGORIES = new Set<IncidentCategory>([
    'electrical', 'laboratory', 'water', 'connectivity', 'equipment', 'safety', 'maintenance',
]);
const STATUSES = new Set<IncidentStatus>(['open', 'assigned', 'in_progress', 'resolved', 'closed']);
const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';

export type CourseActorId =
    | 'reporter-1'
    | 'reporter-2'
    | 'technician-1'
    | 'technician-2'
    | 'coordinator-1';

export type RemoteIncidentRepositoryOptions = Readonly<{
    actorId: CourseActorId;
    accessToken: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}>;

type RemoteIncidentDto = Extract<ParseResult, { ok: true }>['value'];
type IncidentListDto = Readonly<{ items: readonly RemoteIncidentDto[] }>;
type CreateIncidentResponse = Readonly<{
    incident: RemoteIncidentDto;
    operationId: string;
    duplicate: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIncidentDto(value: unknown): RemoteIncidentDto | null {
    const parsed = parseRemoteResource(value);
    if (!parsed.ok || !STATUSES.has(parsed.value.status as IncidentStatus)) return null;
    if (parsed.value.payload === null) return parsed.value;

    const payload = parsed.value.payload;
    const assignedTechnicianId = payload.assignedTechnicianId;
    if (
        typeof payload.category !== 'string' || !CATEGORIES.has(payload.category as IncidentCategory) ||
        typeof payload.description !== 'string' || payload.description.trim().length === 0 ||
        typeof payload.location !== 'string' || payload.location.trim().length === 0 ||
        typeof payload.reporterId !== 'string' || payload.reporterId.trim().length === 0 ||
        !(assignedTechnicianId === null ||
            (typeof assignedTechnicianId === 'string' && assignedTechnicianId.trim().length > 0))
    ) {
        return null;
    }
    return parsed.value;
}

function isIncidentList(value: unknown): value is IncidentListDto {
    if (!isRecord(value) || !Array.isArray(value.items)) return false;
    return value.items.every((item) => parseIncidentDto(item) !== null);
}

function isIncident(value: unknown): value is RemoteIncidentDto {
    return parseIncidentDto(value) !== null;
}

function isCreateIncidentResponse(value: unknown): value is CreateIncidentResponse {
    return isRecord(value) &&
        isIncident(value.incident) &&
        typeof value.operationId === 'string' && value.operationId.trim().length > 0 &&
        typeof value.duplicate === 'boolean';
}

function toSnapshot(dto: RemoteIncidentDto): IncidentSnapshot {
    if (dto.payload === null) {
        return { id: dto.id, version: dto.version, status: dto.status as IncidentStatus, incident: null };
    }
    const payload = dto.payload;
    const category = payload.category as IncidentCategory;
    const incident = {
        id: dto.id,
        category,
        status: dto.status as IncidentStatus,
        description: payload.description as string,
        location: { source: 'manual' as const, label: payload.location as string },
        reporterId: payload.reporterId as string,
        assignedTechnicianId: payload.assignedTechnicianId as string | null,
    };
    return { id: dto.id, version: dto.version, status: dto.status as IncidentStatus, incident };
}

function mapResult<T, U>(result: FetchResult<T>, map: (value: T) => U): FetchResult<U> {
    return result.ok ? { ok: true, value: map(result.value) } : result;
}

export class RemoteIncidentRepository implements IncidentRepository {
    private readonly baseUrl: string;
    private readonly headers: Readonly<Record<string, string>>;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(options: RemoteIncidentRepositoryOptions) {
        this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_BASE_URL)
            .replace(/\/$/, '');
        this.headers = {
            Accept: 'application/json',
            Authorization: `Bearer ${options.accessToken}`,
            'X-Course-Actor': options.actorId,
        };
        this.timeoutMs = options.timeoutMs ?? 5000;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async list(): Promise<FetchResult<readonly IncidentSnapshot[]>> {
        const result = await fetchJson(
            `${this.baseUrl}/v1/incidents`,
            isIncidentList,
            this.timeoutMs,
            { headers: this.headers },
            this.fetchImpl,
        );
        return mapResult(result, (body) => body.items.map(toSnapshot));
    }

    async getById(id: string): Promise<FetchResult<IncidentSnapshot | null>> {
        const result = await fetchJson(
            `${this.baseUrl}/v1/incidents/${encodeURIComponent(id)}`,
            isIncident,
            this.timeoutMs,
            { headers: this.headers },
            this.fetchImpl,
        );
        return mapResult(result, toSnapshot);
    }

    async create(
        input: CreateIncidentInput,
        idempotencyKey: string,
    ): Promise<FetchResult<IncidentSnapshot>> {
        if (idempotencyKey.trim().length < 8) {
            return { ok: false, reason: { kind: 'contract-invalid' } };
        }
        const result = await fetchJson(
            `${this.baseUrl}/v1/incidents`,
            isCreateIncidentResponse,
            this.timeoutMs,
            {
                method: 'POST',
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(input),
            },
            this.fetchImpl,
        );
        return mapResult(result, (body) => toSnapshot(body.incident));
    }
}
