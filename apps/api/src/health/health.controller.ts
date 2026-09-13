import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthService, type ReadinessResult } from './health.service.js';
import { ReadinessUnavailableException } from './readiness-unavailable.exception.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  // Explicit @Inject(HealthService) rather than relying on reflected
  // design:paramtypes metadata: esbuild-based transforms (tsx, vitest) do
  // not reliably emit that metadata for every case, which silently leaves
  // this undefined at runtime under dev/test tooling even though a real
  // `tsc` build emits it correctly. An explicit token works under both.
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The process is running and able to accept requests.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'All dependencies (PostgreSQL, Redis) are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'One or more dependencies are unreachable.' })
  async ready(): Promise<ReadinessResult> {
    const result = await this.healthService.checkReadiness();
    if (result.status !== 'ok') {
      throw new ReadinessUnavailableException(result);
    }
    return result;
  }
}
