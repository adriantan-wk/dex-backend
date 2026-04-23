import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PointsService } from './points.service';

type AwardSwapBody = {
  address: string;
  txHash: string;
  chainId: number;
  usdAmount: string;
  swapTimestampSec?: number;
  metadata?: Record<string, unknown>;
};

@Controller('points')
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get('leaderboard')
  async leaderboard(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 50;
    return this.pointsService.getLeaderboard(
      Number.isFinite(parsed) ? parsed : 50,
    );
  }

  @Get(':address')
  async getAccount(@Param('address') address: string) {
    return this.pointsService.getAccount(address);
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

  @Post('award/swap')
  async awardFromSwap(@Body() body: AwardSwapBody) {
    return this.pointsService.awardPointsFromSwap(body);
  }
}
