import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class PromoterDecisionDto {
  @ApiPropertyOptional({ description: 'Motivo de rechazo/suspensión' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetRequireApprovalDto {
  @ApiProperty({ description: 'true = exigir autorización de admin; false = modo pruebas' })
  @IsBoolean()
  requireApproval!: boolean;
}
