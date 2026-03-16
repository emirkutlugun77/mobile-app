import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/v1/device/register (POST)', () => {
    return request(app.getHttpServer())
      .post('/v1/device/register')
      .send({
        device_id: '550e8400-e29b-41d4-a716-446655440000',
        timezone: 'UTC',
      })
      .expect(201);
  });
});
