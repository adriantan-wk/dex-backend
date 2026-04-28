import { Controller, Get, Param, Query } from '@nestjs/common';
import { PointsService } from './points.service';

@Controller('points')
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get('seasons')
  async seasons() {
    return this.pointsService.listSeasons();
  }

  @Get('leaderboard')
  async leaderboard(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('season') season?: string,
    @Query('address') address?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    const parsedPage = page ? Number(page) : 1;
    return this.pointsService.getLeaderboard(
      Number.isFinite(parsed) ? parsed : 50,
      season,
      address,
      Number.isFinite(parsedPage) ? parsedPage : 1,
    );
  }

  @Get(':address')
  async getAccount(
    @Param('address') address: string,
    @Query('season') season?: string,
  ) {
    return this.pointsService.getAccount(address, season);
  }

  @Get(':address/ledger')
  async listLedger(
    @Param('address') address: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    return this.pointsService.listLedger(
      address,
      Number.isFinite(parsed) ? parsed : 50,
    );
  }
}
