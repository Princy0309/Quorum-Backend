# 🔍 Organization Members Search & Role Filter Integration Guide (Mobile & Web)

This guide documents the search and role filtering feature for the **Organization Members** tab (as seen on the Organization main screen).

---

## 1. Feature Overview

On the Organization screen under the **Members** tab:
1. **Search Input Bar:** Users can type in real time to filter members by their **Name** or **Email address** (case-insensitive substring search).
2. **Role Filter Pills / Dropdown:** Users can filter members by role:
   - `All` (default)
   - `Admin` (`ORG_ADMIN`)
   - `Team Head` (`TEAM_HEAD`)
   - `Member` (`MEMBER`)

---

## 2. API Endpoint Reference

### Get Organization Members
Fetches members belonging to the organization with optional live query parameters.

- **Method / Path:** `GET /api/v1/organizations/:id/members`
- **Auth:** Bearer Token (`requireOrgMember`)
- **Query Parameters:**
  - `search` *(optional, string)*: Search string matching `name` or `email` (e.g. `?search=tushar` or `?search=gmail.com`).
  - `role` *(optional, enum)*: `ORG_ADMIN`, `TEAM_HEAD`, or `MEMBER`.

#### Example Requests
```http
# 1. Search by name or email
GET /api/v1/organizations/org_123/members?search=tushar

# 2. Filter by role
GET /api/v1/organizations/org_123/members?role=TEAM_HEAD

# 3. Combined search and role filter
GET /api/v1/organizations/org_123/members?search=tushar&role=TEAM_HEAD
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "member_uuid_1",
      "organizationId": "org_uuid_1",
      "userId": "user_uuid_1",
      "role": "TEAM_HEAD",
      "joinedAt": "2026-10-31T08:00:00.000Z",
      "user": {
        "id": "user_uuid_1",
        "name": "tushar",
        "email": "yogendrasingh975926@gmail.com",
        "avatar": "https://..."
      }
    },
    {
      "id": "member_uuid_2",
      "organizationId": "org_uuid_1",
      "userId": "user_uuid_2",
      "role": "MEMBER",
      "joinedAt": "2026-11-01T09:30:00.000Z",
      "user": {
        "id": "user_uuid_2",
        "name": "Tushar",
        "email": "tushartalan10@gmail.com",
        "avatar": "https://..."
      }
    }
  ]
}
```

---

## 3. Frontend Implementation Example (React Native / React)

```typescript
import { useState, useEffect, useTransition } from 'react';

export function OrganizationMembersList({ organizationId }: { organizationId: string }) {
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<'ALL' | 'ORG_ADMIN' | 'TEAM_HEAD' | 'MEMBER'>('ALL');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchMembers = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (selectedRole !== 'ALL') params.append('role', selectedRole);

      try {
        const res = await api.get(`/organizations/${organizationId}/members?${params.toString()}`);
        setMembers(res.data.data);
      } catch (err) {
        console.error('Failed to load members', err);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchMembers, 250);
    return () => clearTimeout(debounceTimer);
  }, [organizationId, search, selectedRole]);

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <TextInput
        placeholder="Search members by name or email..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchInput}
      />

      {/* Role Filter Chips */}
      <View style={styles.filterRow}>
        {(['ALL', 'ORG_ADMIN', 'TEAM_HEAD', 'MEMBER'] as const).map((role) => (
          <TouchableOpacity
            key={role}
            onPress={() => setSelectedRole(role)}
            style={[styles.chip, selectedRole === role && styles.chipActive]}
          >
            <Text style={styles.chipText}>{role.replace('_', ' ')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Member Cards */}
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MemberCard member={item} />}
      />
    </View>
  );
}
```
