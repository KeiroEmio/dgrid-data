import { Controller, Get, Query } from '@nestjs/common';
import { EventsService } from '../service/events.js';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Get()
  findEvents(
    @Query('contractName') contractName?: string,
    @Query('eventName') eventName?: string,
    @Query('fromBlock') fromBlock?: string,
    @Query('toBlock') toBlock?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.eventsService.findEvents({ contractName, eventName, fromBlock, toBlock, limit, offset });
  }

  @Get('summary')
  getEventSummary() {
    return this.eventsService.getEventSummary();
  }
}
