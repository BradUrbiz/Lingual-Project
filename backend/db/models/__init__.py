"""Import every model module so `Base.metadata` is fully populated.

Alembic and the schema/migration tests rely on importing this package to see
the complete table set. Keep all model modules imported here.
"""

from backend.db.models import (  # noqa: F401
    assignment,
    canvas,
    compliance,
    lti,
    migration,
    org,
    practice,
)

# Re-export the model classes for convenient access (e.g. resolution helper).
from backend.db.models.assignment import Assignment  # noqa: F401,E402
from backend.db.models.canvas import (  # noqa: F401,E402
    CanvasConnection,
    CanvasCourseContent,
    CanvasRosterEntry,
)
from backend.db.models.compliance import (  # noqa: F401,E402
    ConsentEvent,
    DeletionExecutionRun,
    DeletionRequest,
    GuardianConsentPacket,
    StudentComplianceRecord,
)
from backend.db.models.lti import LtiPlatform, LtiSession  # noqa: F401,E402
from backend.db.models.migration import MigrationImportRun  # noqa: F401,E402
from backend.db.models.org import (  # noqa: F401,E402
    Class,
    ClassJoinCode,
    ClassTeacher,
    Enrollment,
    Membership,
    Organization,
)
from backend.db.models.practice import LearningEvent, PracticeSession  # noqa: F401,E402

__all__ = [
    'Assignment',
    'CanvasConnection',
    'CanvasCourseContent',
    'CanvasRosterEntry',
    'Class',
    'ClassJoinCode',
    'ClassTeacher',
    'ConsentEvent',
    'DeletionExecutionRun',
    'DeletionRequest',
    'Enrollment',
    'GuardianConsentPacket',
    'LearningEvent',
    'LtiPlatform',
    'LtiSession',
    'Membership',
    'MigrationImportRun',
    'Organization',
    'PracticeSession',
    'StudentComplianceRecord',
]
