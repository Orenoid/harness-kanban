import { AuthModule } from '@/auth/auth.module'
import { DatabaseModule } from '@/database/database.module'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { GithubController } from './github.controller'
import { GithubService } from './github.service'

@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
