import { Controller, Get } from '@nestjs/common';
import { IndexerService } from '../service/indexer.js';

@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) { }

  @Get('states')
  findStates() {
    return this.indexerService.findStates();
  }
}
