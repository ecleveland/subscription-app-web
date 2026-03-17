import {
  IsArray,
  ArrayMinSize,
  IsString,
  IsEnum,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';

export enum BulkAction {
  DELETE = 'delete',
  ACTIVATE = 'activate',
  DEACTIVATE = 'deactivate',
  CHANGE_CATEGORY = 'changeCategory',
}

export class BulkOperationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids: string[];

  @IsEnum(BulkAction)
  action: BulkAction;

  @ValidateIf((o: BulkOperationDto) => o.action === BulkAction.CHANGE_CATEGORY)
  @IsString()
  @IsNotEmpty()
  category?: string;
}
