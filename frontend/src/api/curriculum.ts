import api from './index';
import type { CurriculumPackageV1 } from '@/types';

interface GetSampleCurriculumResponse {
  success: boolean;
  package: CurriculumPackageV1;
  error?: string;
}

export const getSampleCurriculumPackage = async (): Promise<CurriculumPackageV1> => {
  const response = await api.get<GetSampleCurriculumResponse>('/curriculum/sample');
  if (response.data.success) {
    return response.data.package;
  }
  throw new Error(response.data.error || 'Failed to load sample curriculum');
};
