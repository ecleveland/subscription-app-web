import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Validate a route param is a well-formed Mongo ObjectId, turning an invalid id
 * into a clean 400 instead of a CastError surfacing as a 500 deeper in a
 * service's `findById`/`new Types.ObjectId(...)` call.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`"${value}" is not a valid id`);
    }
    return value;
  }
}
