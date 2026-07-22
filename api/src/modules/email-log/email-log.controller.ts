import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { EmailLogService } from './email-log.service';
import { EmailLogPageDto, EmailLogQueryDto } from './dto/email-log.dto';

@ApiTags('email-log')
@ApiBearerAuth()
@Controller('admin/email-log')
export class EmailLogController {
  constructor(private readonly service: EmailLogService) {}

  @Get()
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Registro de correos enviados (admin): filtros + búsqueda + keyset' })
  @ApiOkResponse({ type: EmailLogPageDto })
  list(@Query() query: EmailLogQueryDto) {
    return this.service.list(query);
  }
}
