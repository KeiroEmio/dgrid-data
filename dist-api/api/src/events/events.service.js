var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { EventsRepository } from './events.repository.js';
let EventsService = class EventsService {
    eventsRepository;
    constructor(eventsRepository) {
        this.eventsRepository = eventsRepository;
    }
    findEvents(query) {
        return this.eventsRepository.findEvents({
            contractName: query.contractName,
            eventName: query.eventName,
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            limit: Math.min(Number(query.limit ?? '50'), 200),
            offset: Number(query.offset ?? '0')
        });
    }
    getEventSummary() {
        return this.eventsRepository.getEventSummary();
    }
};
EventsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [EventsRepository])
], EventsService);
export { EventsService };
